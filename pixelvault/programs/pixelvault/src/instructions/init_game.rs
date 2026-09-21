use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{constants::*, state::Game};

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct InitGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// Backing lives here. Owned by the game PDA, so the studio can never move it.
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Where the studio's share of the margin is paid.
    #[account(token::mint = usdc_mint)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_game(ctx: Context<InitGame>, game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.authority = ctx.accounts.authority.key();
    game.usdc_mint = ctx.accounts.usdc_mint.key();
    game.treasury = ctx.accounts.treasury.key();
    game.game_id = game_id;
    game.total_backed = 0;
    game.crafting_paused = false;
    game.bump = ctx.bumps.game;

    msg!("game {} registered", game_id);
    Ok(())
}
