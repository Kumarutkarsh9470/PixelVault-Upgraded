pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");

#[program]
pub mod pixelvault {
    use super::*;

    /// Register a game and create its USDC backing vault.
    pub fn init_game(ctx: Context<InitGame>, game_id: u64) -> Result<()> {
        instructions::init_game::handle_init_game(ctx, game_id)
    }

    /// Define an item class: price, backing ratio inside the protocol band,
    /// and a Token-2022 mint the game PDA controls.
    pub fn create_item_class(
        ctx: Context<CreateItemClass>,
        class_id: u64,
        price: u64,
        backing_bps: u16,
    ) -> Result<()> {
        instructions::create_item_class::handle_create_item_class(ctx, class_id, price, backing_bps)
    }

    /// Pay the mint price: backing to the vault, margin split between studio
    /// and protocol, one item unit minted to the player.
    pub fn craft(ctx: Context<Craft>) -> Result<()> {
        instructions::craft::handle_craft(ctx)
    }

    /// Burn one unit and take the backing back out of the vault.
    pub fn redeem(ctx: Context<Redeem>) -> Result<()> {
        instructions::redeem::handle_redeem(ctx)
    }
}
