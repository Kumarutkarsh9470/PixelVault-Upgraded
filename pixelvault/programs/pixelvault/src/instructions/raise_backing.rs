use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::*,
    error::PixelVaultError,
    events::BackingRaised,
    math::{add, apply_bps, sub},
    state::{Game, ItemClass, Protocol},
};

/// Backing can only ever go up. Raising it requires the studio to deposit the
/// difference for every unit already in circulation, so existing holders
/// benefit immediately and the vault stays fully covered.
#[derive(Accounts)]
pub struct RaiseBacking<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump,
        has_one = authority @ PixelVaultError::Unauthorized
    )]
    pub game: Box<Account<'info, Game>>,

    #[account(
        mut,
        has_one = game,
        seeds = [CLASS_SEED, game.key().as_ref(), &item_class.class_id.to_le_bytes()],
        bump = item_class.bump
    )]
    pub item_class: Box<Account<'info, ItemClass>>,

    #[account(address = protocol.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = authority)]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_raise_backing(ctx: Context<RaiseBacking>, new_bps: u16) -> Result<()> {
    let class = &ctx.accounts.item_class;
    let old_bps = class.backing_bps;
    require!(new_bps > old_bps, PixelVaultError::BackingMustIncrease);
    require!(new_bps <= MAX_BACKING_BPS, PixelVaultError::BackingRatioOutOfBand);

    let new_per_unit = apply_bps(class.price, new_bps)?;
    let delta = sub(new_per_unit, class.backing_per_unit)?;
    let deposit = delta
        .checked_mul(class.backed_supply)
        .ok_or(PixelVaultError::MathOverflow)?;

    if deposit > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.authority_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            deposit,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    let class = &mut ctx.accounts.item_class;
    class.backing_bps = new_bps;
    class.backing_per_unit = new_per_unit;

    let game = &mut ctx.accounts.game;
    game.total_backed = add(game.total_backed, deposit)?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_backed = add(protocol.total_backed, deposit)?;

    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.game.total_backed,
        PixelVaultError::VaultUndercollateralized
    );

    emit!(BackingRaised {
        game: ctx.accounts.game.key(),
        item_class: ctx.accounts.item_class.key(),
        old_bps,
        new_bps,
        deposit,
    });
    Ok(())
}
