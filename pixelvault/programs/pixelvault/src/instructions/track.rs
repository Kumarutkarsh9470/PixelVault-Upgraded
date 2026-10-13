//! Registering a circuit on-chain: the geometry every verified run is replayed
//! against. Samples arrive in chunks because a centreline is far larger than a
//! transaction, and freezing locks the geometry so times stay comparable.

use anchor_lang::prelude::*;

use crate::constants::{LEADERBOARD_SEED, TRACK_SEED};
use crate::error::PixelVaultError;
use crate::sim::account::{Leaderboard, TrackConfig, MAX_CHECKPOINTS, MAX_PADS, MAX_SAMPLES, MAX_TRACK_NAME};
use crate::sim::track::{BoostPad, Sample};

/// A boost pad as the client describes it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PadArg {
    pub sample: u16,
    pub lateral: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TrackArgs {
    pub name: String,
    pub laps: u8,
    pub spacing: i32,
    pub wall_offset: i32,
    pub start_sample: u16,
    pub start_heading: u32,
    pub sample_count: u16,
    pub checkpoints: Vec<u16>,
    pub pads: Vec<PadArg>,
}

/// Tracks are scoped to the key that registers them: the PDA seeds include the
/// authority, so nobody can squat another studio's track id or pass off a
/// different circuit under it. Clients find a track by the address its author
/// publishes, not by id alone.
#[derive(Accounts)]
#[instruction(track_id: u64)]
pub struct InitTrack<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TrackConfig>(),
        seeds = [TRACK_SEED, authority.key().as_ref(), &track_id.to_le_bytes()],
        bump,
    )]
    pub track: AccountLoader<'info, TrackConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Leaderboard>(),
        seeds = [LEADERBOARD_SEED, authority.key().as_ref(), &track_id.to_le_bytes()],
        bump,
    )]
    pub leaderboard: AccountLoader<'info, Leaderboard>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_track(ctx: Context<InitTrack>, track_id: u64, args: TrackArgs) -> Result<()> {
    require!(args.name.len() <= MAX_TRACK_NAME, PixelVaultError::NameTooLong);
    require!(args.laps >= 1, PixelVaultError::InvalidTrack);
    require!(
        args.sample_count as usize <= MAX_SAMPLES && args.sample_count >= 16,
        PixelVaultError::InvalidTrack
    );
    require!(
        !args.checkpoints.is_empty() && args.checkpoints.len() <= MAX_CHECKPOINTS,
        PixelVaultError::InvalidTrack
    );
    require!(args.pads.len() <= MAX_PADS, PixelVaultError::InvalidTrack);
    require!(args.start_sample < args.sample_count, PixelVaultError::InvalidTrack);
    require!(args.spacing > 0 && args.wall_offset > 0, PixelVaultError::InvalidTrack);
    // Checkpoints must be in order around the lap, with the start line first.
    require!(args.checkpoints[0] == 0, PixelVaultError::InvalidTrack);
    for pair in args.checkpoints.windows(2) {
        require!(pair[0] < pair[1], PixelVaultError::InvalidTrack);
    }
    require!(
        *args.checkpoints.last().unwrap() < args.sample_count,
        PixelVaultError::InvalidTrack
    );

    let track = &mut ctx.accounts.track.load_init()?;
    track.authority = ctx.accounts.authority.key();
    track.track_id = track_id;
    track.name[..args.name.len()].copy_from_slice(args.name.as_bytes());
    track.laps = args.laps;
    track.spacing = args.spacing;
    track.wall_offset = args.wall_offset;
    track.start_sample = args.start_sample;
    track.start_heading = args.start_heading;
    track.sample_count = args.sample_count;
    track.checkpoint_count = args.checkpoints.len() as u16;
    track.pad_count = args.pads.len() as u16;
    track.bump = ctx.bumps.track;
    for (slot, value) in track.checkpoints.iter_mut().zip(args.checkpoints.iter()) {
        *slot = *value;
    }
    for (slot, pad) in track.pads.iter_mut().zip(args.pads.iter()) {
        require!(pad.sample < args.sample_count, PixelVaultError::InvalidTrack);
        *slot = BoostPad {
            lateral: pad.lateral,
            sample: pad.sample,
            _padding: [0; 2],
        };
    }

    let board = &mut ctx.accounts.leaderboard.load_init()?;
    board.track_id = track_id;
    board.bump = ctx.bumps.leaderboard;
    Ok(())
}

#[derive(Accounts)]
pub struct EditTrack<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [TRACK_SEED, track.load()?.authority.as_ref(), &track.load()?.track_id.to_le_bytes()],
        bump = track.load()?.bump,
        has_one = authority @ PixelVaultError::Unauthorized,
    )]
    pub track: AccountLoader<'info, TrackConfig>,
}

/// Writes a run of centreline samples. `data` is raw `Sample` bytes: sixteen
/// per sample, exactly as the simulation reads them.
pub fn handle_write_track_samples(ctx: Context<EditTrack>, offset: u16, data: Vec<u8>) -> Result<()> {
    const SAMPLE_BYTES: usize = std::mem::size_of::<Sample>();
    let track = &mut ctx.accounts.track.load_mut()?;
    require!(track.frozen == 0, PixelVaultError::TrackFrozen);
    require!(
        !data.is_empty() && data.len() % SAMPLE_BYTES == 0,
        PixelVaultError::InvalidTrack
    );
    let count = data.len() / SAMPLE_BYTES;
    let end = offset as usize + count;
    require!(end <= track.sample_count as usize, PixelVaultError::InvalidTrack);

    for (index, chunk) in data.chunks_exact(SAMPLE_BYTES).enumerate() {
        let read = |at: usize| i32::from_le_bytes([chunk[at], chunk[at + 1], chunk[at + 2], chunk[at + 3]]);
        track.samples[offset as usize + index] = Sample {
            x: read(0),
            z: read(4),
            fx: read(8),
            fz: read(12),
        };
    }
    Ok(())
}

/// Locks the geometry. From here the circuit can never change, so every time
/// on its leaderboard was set on the same track.
pub fn handle_freeze_track(ctx: Context<EditTrack>) -> Result<()> {
    let track = &mut ctx.accounts.track.load_mut()?;
    require!(track.frozen == 0, PixelVaultError::TrackFrozen);
    track.frozen = 1;
    Ok(())
}
