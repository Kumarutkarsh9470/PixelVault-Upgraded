pub mod constants;
pub mod error;
pub mod events;
pub mod grant;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");

#[program]
pub mod pixelvault {
    use super::*;

    /// One-time setup by the protocol admin: USDC mint, fee treasury, fee and launch caps.
    pub fn init_protocol(
        ctx: Context<InitProtocol>,
        fee_bps: u16,
        max_backed_per_player: u64,
        global_backed_cap: u64,
    ) -> Result<()> {
        instructions::init_protocol::handle_init_protocol(
            ctx,
            fee_bps,
            max_backed_per_player,
            global_backed_cap,
        )
    }

    /// Admin switches: global crafting pause, fee (capped) and launch caps.
    pub fn update_protocol(
        ctx: Context<UpdateProtocol>,
        crafting_paused: Option<bool>,
        fee_bps: Option<u16>,
        max_backed_per_player: Option<u64>,
        global_backed_cap: Option<u64>,
    ) -> Result<()> {
        instructions::update_protocol::handle_update_protocol(
            ctx,
            crafting_paused,
            fee_bps,
            max_backed_per_player,
            global_backed_cap,
        )
    }

    /// Permissionless: register a game, its grant-signing key and its USDC vault.
    pub fn register_game(
        ctx: Context<RegisterGame>,
        game_id: u64,
        name: String,
        grant_signer: Pubkey,
        backed_cap: u64,
    ) -> Result<()> {
        instructions::register_game::handle_register_game(ctx, game_id, name, grant_signer, backed_cap)
    }

    /// Studio switches: crafting pause, grant-signer rotation, backing cap.
    pub fn update_game(
        ctx: Context<UpdateGame>,
        crafting_paused: Option<bool>,
        grant_signer: Option<Pubkey>,
        backed_cap: Option<u64>,
    ) -> Result<()> {
        instructions::update_game::handle_update_game(ctx, crafting_paused, grant_signer, backed_cap)
    }

    /// Define an item class: price, backing ratio inside the protocol band,
    /// optional supply cap, and a Token-2022 mint the game PDA controls.
    pub fn create_item_class(
        ctx: Context<CreateItemClass>,
        class_id: u64,
        price: u64,
        backing_bps: u16,
        max_supply: u64,
    ) -> Result<()> {
        instructions::create_item_class::handle_create_item_class(
            ctx,
            class_id,
            price,
            backing_bps,
            max_supply,
        )
    }

    /// Spend a server-signed material grant plus the USDC price: backing to
    /// the vault, margin split between studio and protocol, one unit minted.
    pub fn craft(ctx: Context<Craft>, grant_seq: u64, expires_at: i64) -> Result<()> {
        instructions::craft::handle_craft(ctx, grant_seq, expires_at)
    }

    /// Burn one unit and take its backing back out of the vault.
    pub fn redeem(ctx: Context<Redeem>) -> Result<()> {
        instructions::redeem::handle_redeem(ctx)
    }

    /// Raise an item class's backing, depositing the difference for every unit in circulation.
    pub fn raise_backing(ctx: Context<RaiseBacking>, new_bps: u16) -> Result<()> {
        instructions::raise_backing::handle_raise_backing(ctx, new_bps)
    }
}
