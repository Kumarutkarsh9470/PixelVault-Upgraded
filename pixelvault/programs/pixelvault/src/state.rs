use anchor_lang::prelude::*;

use crate::constants::MAX_GAME_NAME_LEN;

/// Protocol-wide configuration and totals.
#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    /// USDC token account that receives the protocol fee.
    pub treasury: Pubkey,
    /// Share of each studio's margin taken as the protocol fee.
    pub fee_bps: u16,
    /// Launch safety rail: lifetime backing a single player may craft per game. Zero means no cap.
    pub max_backed_per_player: u64,
    /// Launch safety rail: total backing across all games. Zero means no cap.
    pub global_backed_cap: u64,
    pub total_backed: u64,
    pub crafting_paused: bool,
    pub bump: u8,
}

/// One registered game. Owns a USDC vault holding the backing of every item
/// its classes have minted.
#[account]
#[derive(InitSpace)]
pub struct Game {
    pub authority: Pubkey,
    /// Key the game server uses to sign material grants.
    pub grant_signer: Pubkey,
    /// USDC token account that receives the studio's share of the margin.
    pub treasury: Pubkey,
    pub game_id: u64,
    /// Total USDC this game owes to item holders. The vault must always cover it.
    pub total_backed: u64,
    /// Zero means no cap.
    pub backed_cap: u64,
    pub total_crafted: u64,
    pub total_redeemed: u64,
    pub crafting_paused: bool,
    pub bump: u8,
    #[max_len(MAX_GAME_NAME_LEN)]
    pub name: String,
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
    /// Lifetime crafting cap for limited editions. Zero means no cap.
    pub max_supply: u64,
    /// Units currently in circulation, each owed `backing_per_unit`.
    pub backed_supply: u64,
    pub total_crafted: u64,
    pub total_redeemed: u64,
    pub bump: u8,
}

/// Per player, per game. The sequence number makes each material grant
/// single-use without creating an account per grant.
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub game: Pubkey,
    pub player: Pubkey,
    pub next_grant_seq: u64,
    pub total_backed_crafted: u64,
    pub bump: u8,
}
