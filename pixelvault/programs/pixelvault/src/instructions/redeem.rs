use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::*,
    error::PixelVaultError,
    events::ItemRedeemed,
    math::sub,
    state::{Game, ItemClass, Protocol},
};

/// Redemption deliberately has no pause switch, no cap and no game-server
/// involvement: if the studio disappears, holders still get their backing out.
#[derive(Accounts)]
pub struct Redeem<'info> {
    pub player: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump
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

    #[account(mut, token::mint = usdc_mint, token::authority = player)]
    pub player_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = item_class.mint)]
    pub item_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = item_mint,
        associated_token::authority = player,
        associated_token::token_program = item_token_program,
    )]
    pub player_item: Box<InterfaceAccount<'info, TokenAccount>>,

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
    let game_bump = [ctx.accounts.game.bump];
    let game_seeds: &[&[u8]] = &[GAME_SEED, &game_id_bytes, &game_bump];
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

    let game = &mut ctx.accounts.game;
    game.total_backed = sub(game.total_backed, backing)?;
    game.total_redeemed = game.total_redeemed.saturating_add(1);

    let class = &mut ctx.accounts.item_class;
    class.backed_supply = sub(class.backed_supply, 1)?;
    class.total_redeemed = class.total_redeemed.saturating_add(1);

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_backed = sub(protocol.total_backed, backing)?;

    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.game.total_backed,
        PixelVaultError::VaultUndercollateralized
    );

    emit!(ItemRedeemed {
        game: ctx.accounts.game.key(),
        item_class: ctx.accounts.item_class.key(),
        player: ctx.accounts.player.key(),
        backing,
        game_total_backed: ctx.accounts.game.total_backed,
    });
    Ok(())
}
