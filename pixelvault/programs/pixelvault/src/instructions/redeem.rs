use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::*,
    error::PixelVaultError,
    state::{Game, ItemClass},
};

/// Redemption deliberately has no pause switch and no game-server involvement:
/// if the studio disappears, holders can still get their backing out.
#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        has_one = game,
        seeds = [CLASS_SEED, game.key().as_ref(), &item_class.class_id.to_le_bytes()],
        bump = item_class.bump
    )]
    pub item_class: Account<'info, ItemClass>,

    #[account(address = game.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = usdc_mint, token::authority = player)]
    pub player_usdc: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = item_class.mint)]
    pub item_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = item_mint,
        associated_token::authority = player,
        associated_token::token_program = item_token_program,
    )]
    pub player_item: InterfaceAccount<'info, TokenAccount>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub item_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_redeem(ctx: Context<Redeem>) -> Result<()> {
    let backing = ctx.accounts.item_class.backing_per_unit;

    burn(
        CpiContext::new(
            ctx.accounts.item_token_program.key(),
            Burn {
                mint: ctx.accounts.item_mint.to_account_info(),
                from: ctx.accounts.player_item.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        1,
    )?;

    let game_id_bytes = ctx.accounts.game.game_id.to_le_bytes();
    let game_seeds: &[&[u8]] = &[GAME_SEED, &game_id_bytes, &[ctx.accounts.game.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.usdc_token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.player_usdc.to_account_info(),
                authority: ctx.accounts.game.to_account_info(),
            },
            &[game_seeds],
        ),
        backing,
        ctx.accounts.usdc_mint.decimals,
    )?;

    ctx.accounts.game.total_backed = ctx
        .accounts
        .game
        .total_backed
        .checked_sub(backing)
        .ok_or(PixelVaultError::MathOverflow)?;
    ctx.accounts.item_class.backed_supply = ctx
        .accounts
        .item_class
        .backed_supply
        .checked_sub(1)
        .ok_or(PixelVaultError::MathOverflow)?;

    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.game.total_backed,
        PixelVaultError::VaultUndercollateralized
    );

    msg!("redeemed: {} USDC returned", backing);
    Ok(())
}
