use anchor_lang::prelude::*;

use crate::{constants::*, error::PixelVaultError, state::Game};

/// Studio controls. Pausing stops crafting only: redemption stays open.
#[derive(Accounts)]
pub struct UpdateGame<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump,
        has_one = authority @ PixelVaultError::Unauthorized
    )]
    pub game: Account<'info, Game>,
}

pub fn handle_update_game(
    ctx: Context<UpdateGame>,
    crafting_paused: Option<bool>,
    grant_signer: Option<Pubkey>,
    backed_cap: Option<u64>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    if let Some(paused) = crafting_paused {
        game.crafting_paused = paused;
    }
    if let Some(signer) = grant_signer {
        game.grant_signer = signer;
    }
    if let Some(cap) = backed_cap {
        game.backed_cap = cap;
    }
    Ok(())
}
