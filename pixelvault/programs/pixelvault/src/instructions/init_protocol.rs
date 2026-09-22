use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::{constants::*, error::PixelVaultError, state::Protocol};

#[derive(Accounts)]
pub struct InitProtocol<'info> {
    #[account(mut, address = PROTOCOL_ADMIN @ PixelVaultError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol: Account<'info, Protocol>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = usdc_mint)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_protocol(
    ctx: Context<InitProtocol>,
    fee_bps: u16,
    max_backed_per_player: u64,
    global_backed_cap: u64,
) -> Result<()> {
    require!(fee_bps <= MAX_PROTOCOL_FEE_BPS, PixelVaultError::FeeTooHigh);

    let protocol = &mut ctx.accounts.protocol;
    protocol.admin = ctx.accounts.admin.key();
    protocol.usdc_mint = ctx.accounts.usdc_mint.key();
    protocol.treasury = ctx.accounts.treasury.key();
    protocol.fee_bps = fee_bps;
    protocol.max_backed_per_player = max_backed_per_player;
    protocol.global_backed_cap = global_backed_cap;
    protocol.total_backed = 0;
    protocol.crafting_paused = false;
    protocol.bump = ctx.bumps.protocol;
    Ok(())
}
