use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{
    constants::*,
    error::PixelVaultError,
    state::{Game, ItemClass},
};

#[derive(Accounts)]
#[instruction(class_id: u64)]
pub struct CreateItemClass<'info> {
    #[account(mut, address = game.authority)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = authority,
        space = 8 + ItemClass::INIT_SPACE,
        seeds = [CLASS_SEED, game.key().as_ref(), &class_id.to_le_bytes()],
        bump
    )]
    pub item_class: Account<'info, ItemClass>,

    /// Semi-fungible item mint: 0 decimals, mintable only by the game PDA.
    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = game,
        mint::token_program = item_token_program,
    )]
    pub item_mint: InterfaceAccount<'info, Mint>,

    pub item_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_item_class(
    ctx: Context<CreateItemClass>,
    class_id: u64,
    price: u64,
    backing_bps: u16,
) -> Result<()> {
    require!(price > 0, PixelVaultError::InvalidPrice);
    require!(
        (MIN_BACKING_BPS..=MAX_BACKING_BPS).contains(&backing_bps),
        PixelVaultError::BackingRatioOutOfBand
    );

    let backing_per_unit = u64::try_from(
        (price as u128)
            .checked_mul(backing_bps as u128)
            .ok_or(PixelVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(PixelVaultError::MathOverflow)?,
    )
    .map_err(|_| PixelVaultError::MathOverflow)?;

    let class = &mut ctx.accounts.item_class;
    class.game = ctx.accounts.game.key();
    class.mint = ctx.accounts.item_mint.key();
    class.class_id = class_id;
    class.price = price;
    class.backing_per_unit = backing_per_unit;
    class.backing_bps = backing_bps;
    class.backed_supply = 0;
    class.bump = ctx.bumps.item_class;

    msg!(
        "class {} price {} backing {} ({} bps)",
        class_id,
        price,
        backing_per_unit,
        backing_bps
    );
    Ok(())
}
