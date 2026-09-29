//! Replaying a race takes more compute than one transaction holds, so
//! verification is resumable: the program replays as much of the trace as its
//! budget allows, stores where the car got to, and carries on next time.
//!
//! Nothing here trusts the client. It supplies inputs and pays for the work;
//! every position, speed and split is derived on-chain.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::{LEADERBOARD_SEED, RUN_SEED, TRACK_SEED};
use crate::error::PixelVaultError;
use crate::events::RunVerified;
use crate::sim::account::{Entry, Leaderboard, RunBuffer, TrackConfig, MAX_TRACE_BYTES};
use crate::sim::car::Input;

/// Most steps one transaction may replay. A step costs on the order of a
/// thousand compute units, so this stays inside the 1.4M a transaction can
/// ask for, with room to write the accounts afterwards.
const MAX_STEPS_PER_CALL: u32 = 1_200;

#[derive(Accounts)]
#[instruction(track_id: u64)]
pub struct OpenRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub player: Signer<'info>,
    #[account(
        seeds = [TRACK_SEED, &track_id.to_le_bytes()],
        bump = track.load()?.bump,
    )]
    pub track: AccountLoader<'info, TrackConfig>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + std::mem::size_of::<RunBuffer>(),
        seeds = [RUN_SEED, player.key().as_ref(), &track_id.to_le_bytes()],
        bump,
    )]
    pub run: AccountLoader<'info, RunBuffer>,
    pub system_program: Program<'info, System>,
}

/// Starts a fresh attempt: the buffer is reset, so an abandoned run never
/// bleeds into the next one.
pub fn handle_open_run(ctx: Context<OpenRun>, track_id: u64, trace_len: u16) -> Result<()> {
    require!(
        trace_len >= 2 && trace_len as usize <= MAX_TRACE_BYTES && trace_len % 2 == 0,
        PixelVaultError::MalformedTrace
    );
    let track = ctx.accounts.track.load()?;
    require!(track.frozen == 1, PixelVaultError::TrackNotFrozen);

    // A newly created account loads with load_init; a reused one with load_mut.
    let mut run = match ctx.accounts.run.load_init() {
        Ok(run) => run,
        Err(_) => ctx.accounts.run.load_mut()?,
    };
    run.reset(
        ctx.accounts.player.key(),
        ctx.accounts.payer.key(),
        track_id,
        trace_len,
        &track,
        ctx.bumps.run,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct WriteRun<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [RUN_SEED, player.key().as_ref(), &run.load()?.track_id.to_le_bytes()],
        bump = run.load()?.bump,
        has_one = player @ PixelVaultError::Unauthorized,
    )]
    pub run: AccountLoader<'info, RunBuffer>,
}

/// Uploads part of the trace. Traces are bigger than a transaction, so they
/// arrive in pieces.
pub fn handle_write_run(ctx: Context<WriteRun>, offset: u16, data: Vec<u8>) -> Result<()> {
    let run = &mut ctx.accounts.run.load_mut()?;
    require!(run.steps == 0, PixelVaultError::RunAlreadyStarted);
    let end = offset as usize + data.len();
    require!(
        !data.is_empty() && end <= run.trace_len as usize,
        PixelVaultError::MalformedTrace
    );
    run.trace[offset as usize..end].copy_from_slice(&data);
    if end as u16 > run.written {
        run.written = end as u16;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct VerifyRun<'info> {
    pub player: Signer<'info>,
    #[account(
        seeds = [TRACK_SEED, &track.load()?.track_id.to_le_bytes()],
        bump = track.load()?.bump,
    )]
    pub track: AccountLoader<'info, TrackConfig>,
    #[account(
        mut,
        seeds = [RUN_SEED, player.key().as_ref(), &run.load()?.track_id.to_le_bytes()],
        bump = run.load()?.bump,
        has_one = player @ PixelVaultError::Unauthorized,
        constraint = run.load()?.track_id == track.load()?.track_id @ PixelVaultError::InvalidTrack,
    )]
    pub run: AccountLoader<'info, RunBuffer>,
    #[account(
        mut,
        seeds = [LEADERBOARD_SEED, &leaderboard.load()?.track_id.to_le_bytes()],
        bump = leaderboard.load()?.bump,
        constraint = leaderboard.load()?.track_id == track.load()?.track_id @ PixelVaultError::InvalidTrack,
    )]
    pub leaderboard: AccountLoader<'info, Leaderboard>,
}

/// Replays up to `steps` more steps of the trace, or as many as the remaining
/// compute allows. The last call, which reaches the end of the trace, records
/// the time the program derived.
pub fn handle_verify_run(ctx: Context<VerifyRun>, steps: u32) -> Result<()> {
    let track = ctx.accounts.track.load()?;
    let view = track.view();
    let run = &mut ctx.accounts.run.load_mut()?;
    require!(run.finished == 0, PixelVaultError::RunAlreadyVerified);
    require!(
        run.written == run.trace_len,
        PixelVaultError::TraceIncomplete
    );

    let crossings_needed = view.checkpoints.len() as u16 * view.laps as u16 + 1;
    let mut car = run.car();
    let mut done = 0u32;
    let budget = steps.min(MAX_STEPS_PER_CALL);

    while done < budget && (run.cursor as usize) < run.trace_len as usize {
        let input = Input::unpack(run.trace[run.cursor as usize]);
        let repeat = run.trace[run.cursor as usize + 1];
        require!(repeat > 0, PixelVaultError::MalformedTrace);

        // The car has already crossed the line, yet the trace goes on: the
        // trace is padded, which would hide a slower run behind a fast time.
        require!(
            car.crossings < crossings_needed,
            PixelVaultError::RunFinishedEarly
        );

        car.step(&view, input);
        run.steps += 1;
        done += 1;
        run.repeat_done += 1;
        if run.repeat_done as u8 >= repeat {
            run.repeat_done = 0;
            run.cursor += 2;
        }
    }

    run.save(&car);
    if (run.cursor as usize) < run.trace_len as usize {
        // More to do: the next transaction picks up exactly here.
        return Ok(());
    }

    require!(
        car.crossings >= crossings_needed,
        PixelVaultError::RunNeverFinished
    );
    run.finished = 1;

    let trace_hash = hashv(&[&run.trace[..run.trace_len as usize]]).to_bytes();
    let total_ms = ((run.steps as u64 * 1000) / crate::sim::STEPS_PER_SECOND as u64) as u32;
    let board = &mut ctx.accounts.leaderboard.load_mut()?;
    board.verified_runs = board.verified_runs.saturating_add(1);
    let rank = board.record(Entry {
        player: ctx.accounts.player.key(),
        trace_hash,
        total_ms,
        steps: run.steps,
        set_at: Clock::get()?.unix_timestamp,
    });

    emit!(RunVerified {
        track_id: track.track_id,
        player: ctx.accounts.player.key(),
        total_ms,
        steps: run.steps,
        trace_hash,
        rank: rank.map(|r| r + 1).unwrap_or(0),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRun<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [RUN_SEED, player.key().as_ref(), &run.load()?.track_id.to_le_bytes()],
        bump = run.load()?.bump,
        has_one = player @ PixelVaultError::Unauthorized,
        constraint = run.load()?.payer == rent_refund.key() @ PixelVaultError::Unauthorized,
    )]
    pub run: AccountLoader<'info, RunBuffer>,
    /// CHECK: whoever paid the rent, checked against the buffer above.
    #[account(mut)]
    pub rent_refund: UncheckedAccount<'info>,
}

/// Gives the buffer's rent back to whoever paid it, once the run has been
/// verified, so sponsoring a player's verification costs only the fees.
pub fn handle_close_run(_ctx: Context<CloseRun>) -> Result<()> {
    Ok(())
}
