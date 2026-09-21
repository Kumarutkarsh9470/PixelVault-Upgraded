use anchor_lang::prelude::*;

#[constant]
pub const GAME_SEED: &[u8] = b"game";

#[constant]
pub const CLASS_SEED: &[u8] = b"class";

/// Protocol-enforced backing band, in basis points of the mint price.
/// Below the floor the product degrades into an ordinary mint; at 100% the
/// mint/redeem round trip is costless and can be farmed.
pub const MIN_BACKING_BPS: u16 = 5_000;
pub const MAX_BACKING_BPS: u16 = 9_500;

/// Protocol take: a share of the studio's unbacked margin, never of the backing.
pub const PROTOCOL_FEE_BPS: u16 = 1_250;

pub const BPS_DENOMINATOR: u128 = 10_000;
