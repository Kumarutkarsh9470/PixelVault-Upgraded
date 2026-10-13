use anchor_lang::prelude::*;

use crate::{constants::*, error::PixelVaultError, state::Protocol};

/// Hands the protocol's admin role to another key, for example a multisig
/// before mainnet. The admin can only pause crafting, set the fee (capped)
/// and the launch caps; it never gains access to backing, so the transfer
/// changes who holds the switches, not who holds the money.
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ PixelVaultError::Unauthorized
    )]
    pub protocol: Account<'info, Protocol>,
}

pub fn handle_transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    require!(new_admin != Pubkey::default(), PixelVaultError::Unauthorized);
    ctx.accounts.protocol.admin = new_admin;
    Ok(())
}
