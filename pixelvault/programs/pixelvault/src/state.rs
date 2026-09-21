use anchor_lang::prelude::*;

/// One registered game. Owns a USDC vault holding the backing of every item
/// its classes have minted.
#[account]
#[derive(InitSpace)]
pub struct Game {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub game_id: u64,
    /// Total USDC this game owes to item holders. The vault must always cover it.
    pub total_backed: u64,
    pub crafting_paused: bool,
    pub bump: u8,
}

/// One item class: a Token-2022 mint with 0 decimals whose units are
/// interchangeable and each backed by `backing_per_unit` USDC.
#[account]
#[derive(InitSpace)]
pub struct ItemClass {
    pub game: Pubkey,
    pub mint: Pubkey,
    pub class_id: u64,
    pub price: u64,
    pub backing_per_unit: u64,
    pub backing_bps: u16,
    pub backed_supply: u64,
    pub bump: u8,
}
