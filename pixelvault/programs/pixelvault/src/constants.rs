use anchor_lang::prelude::*;

#[constant]
pub const PROTOCOL_SEED: &[u8] = b"protocol";

#[constant]
pub const GAME_SEED: &[u8] = b"game";

#[constant]
pub const CLASS_SEED: &[u8] = b"class";

#[constant]
pub const PLAYER_SEED: &[u8] = b"player";

/// Protocol-enforced backing band, in basis points of the mint price.
/// Below the floor the product degrades into an ordinary mint; at 100% the
/// mint/redeem round trip is costless and can be farmed.
pub const MIN_BACKING_BPS: u16 = 5_000;
pub const MAX_BACKING_BPS: u16 = 9_500;

/// The protocol fee is a share of the studio's margin, never of the backing.
/// This ceiling cannot be raised after deployment.
pub const MAX_PROTOCOL_FEE_BPS: u16 = 2_500;

pub const BPS_DENOMINATOR: u128 = 10_000;

pub const MAX_GAME_NAME_LEN: usize = 64;

/// Domain separator for material grants, so a signature over grant bytes can
/// never be mistaken for a signature over anything else.
pub const GRANT_DOMAIN: &[u8] = b"PIXELVAULT_GRANT_V2";

/// The only key allowed to initialise the protocol account.
/// Must be replaced with the mainnet admin key before a mainnet build.
pub const PROTOCOL_ADMIN: Pubkey = Pubkey::from_str_const("AduYsbKaeA1GA4MoBC3ZtzoCKSQHRLL3i31yScNTgTX8");
