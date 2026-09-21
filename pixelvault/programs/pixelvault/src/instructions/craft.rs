use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
    },
};

use crate::{
    constants::*,
    error::PixelVaultError,
    state::{Game, ItemClass},
};

#[derive(Accounts)]
pub struct Craft<'info> {
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

    #[account(mut, address = game.treasury)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = usdc_mint)]
    pub protocol_treasury: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = item_class.mint)]
    pub item_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = player,
        associated_token::mint = item_mint,
        associated_token::authority = player,
        associated_token::token_program = item_token_program,
    )]
    pub player_item: InterfaceAccount<'info, TokenAccount>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub item_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_craft(ctx: Context<Craft>) -> Result<()> {
    require!(
        !ctx.accounts.game.crafting_paused,
        PixelVaultError::CraftingPaused
    );

    let price = ctx.accounts.item_class.price;
    let backing = ctx.accounts.item_class.backing_per_unit;
    let margin = price
        .checked_sub(backing)
        .ok_or(PixelVaultError::MathOverflow)?;
    let protocol_fee = u64::try_from(
        (margin as u128)
            .checked_mul(PROTOCOL_FEE_BPS as u128)
            .ok_or(PixelVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(PixelVaultError::MathOverflow)?,
    )
    .map_err(|_| PixelVaultError::MathOverflow)?;
    let studio_cut = margin
        .checked_sub(protocol_fee)
        .ok_or(PixelVaultError::MathOverflow)?;
    let decimals = ctx.accounts.usdc_mint.decimals;

    // The backing is the player money held on their behalf; the rest is revenue.
    transfer_usdc(&ctx, ctx.accounts.vault.to_account_info(), backing, decimals)?;
    if studio_cut > 0 {
        transfer_usdc(
            &ctx,
            ctx.accounts.treasury.to_account_info(),
            studio_cut,
            decimals,
        )?;
    }
    if protocol_fee > 0 {
        transfer_usdc(
            &ctx,
            ctx.accounts.protocol_treasury.to_account_info(),
            protocol_fee,
            decimals,
        )?;
    }

    let game_id_bytes = ctx.accounts.game.game_id.to_le_bytes();
    let game_seeds: &[&[u8]] = &[GAME_SEED, &game_id_bytes, &[ctx.accounts.game.bump]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.item_token_program.key(),
            MintTo {
                mint: ctx.accounts.item_mint.to_account_info(),
                to: ctx.accounts.player_item.to_account_info(),
                authority: ctx.accounts.game.to_account_info(),
            },
            &[game_seeds],
        ),
        1,
    )?;

    ctx.accounts.game.total_backed = ctx
        .accounts
        .game
        .total_backed
        .checked_add(backing)
        .ok_or(PixelVaultError::MathOverflow)?;
    ctx.accounts.item_class.backed_supply = ctx
        .accounts
        .item_class
        .backed_supply
        .checked_add(1)
        .ok_or(PixelVaultError::MathOverflow)?;

    // The vault must always cover everything the game owes its holders.
    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.game.total_backed,
        PixelVaultError::VaultUndercollateralized
    );

    msg!("crafted: backing {} margin {}", backing, margin);
    Ok(())
}

fn transfer_usdc<'info>(
    ctx: &Context<Craft<'info>>,
    to: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to,
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        amount,
        decimals,
    )
}
