use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    error::PixelVaultError,
    events::GameRegistered,
    state::{Game, Protocol},
};

/// Permissionless: any studio can register a game and get its own vault.
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct RegisterGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Box<Account<'info, Game>>,

    #[account(address = protocol.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Backing lives here. Owned by the game PDA, so the studio can never move it.
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Where the studio's share of the margin is paid.
    #[account(token::mint = usdc_mint)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_game(
    ctx: Context<RegisterGame>,
    game_id: u64,
    name: String,
    grant_signer: Pubkey,
    backed_cap: u64,
) -> Result<()> {
    require!(name.len() <= MAX_GAME_NAME_LEN, PixelVaultError::NameTooLong);

    let game = &mut ctx.accounts.game;
    game.authority = ctx.accounts.authority.key();
    game.grant_signer = grant_signer;
    game.treasury = ctx.accounts.treasury.key();
    game.game_id = game_id;
    game.total_backed = 0;
    game.backed_cap = backed_cap;
    game.total_crafted = 0;
    game.total_redeemed = 0;
    game.crafting_paused = false;
    game.bump = ctx.bumps.game;
    game.name = name.clone();

    emit!(GameRegistered {
        game: game.key(),
        game_id,
        authority: game.authority,
        name,
    });
    Ok(())
}
