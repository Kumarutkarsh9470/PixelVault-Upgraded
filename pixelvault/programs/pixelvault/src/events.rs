use anchor_lang::prelude::*;

#[event]
pub struct GameRegistered {
    pub game: Pubkey,
    pub game_id: u64,
    pub authority: Pubkey,
    pub name: String,
}

#[event]
pub struct ItemClassCreated {
    pub game: Pubkey,
    pub item_class: Pubkey,
    pub mint: Pubkey,
    pub class_id: u64,
    pub price: u64,
    pub backing_bps: u16,
    pub max_supply: u64,
}

#[event]
pub struct ItemCrafted {
    pub game: Pubkey,
    pub item_class: Pubkey,
    pub player: Pubkey,
    pub price: u64,
    pub backing: u64,
    pub studio_cut: u64,
    pub protocol_fee: u64,
    pub grant_seq: u64,
    pub game_total_backed: u64,
}

#[event]
pub struct ItemRedeemed {
    pub game: Pubkey,
    pub item_class: Pubkey,
    pub player: Pubkey,
    pub backing: u64,
    pub game_total_backed: u64,
}

#[event]
pub struct BackingRaised {
    pub game: Pubkey,
    pub item_class: Pubkey,
    pub old_bps: u16,
    pub new_bps: u16,
    pub deposit: u64,
}
