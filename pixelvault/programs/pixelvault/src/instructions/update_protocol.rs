use anchor_lang::prelude::*;

use crate::{constants::*, error::PixelVaultError, state::Protocol};

/// Admin controls. None of them can move backing: pausing stops crafting only,
/// and the fee can never exceed `MAX_PROTOCOL_FEE_BPS`.
#[derive(Accounts)]
pub struct UpdateProtocol<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ PixelVaultError::Unauthorized
    )]
    pub protocol: Account<'info, Protocol>,
}

pub fn handle_update_protocol(
    ctx: Context<UpdateProtocol>,
    crafting_paused: Option<bool>,
    fee_bps: Option<u16>,
    max_backed_per_player: Option<u64>,
    global_backed_cap: Option<u64>,
) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    if let Some(paused) = crafting_paused {
        protocol.crafting_paused = paused;
    }
    if let Some(fee) = fee_bps {
        require!(fee <= MAX_PROTOCOL_FEE_BPS, PixelVaultError::FeeTooHigh);
        protocol.fee_bps = fee;
    }
    if let Some(cap) = max_backed_per_player {
        protocol.max_backed_per_player = cap;
    }
    if let Some(cap) = global_backed_cap {
        protocol.global_backed_cap = cap;
    }
    Ok(())
}
