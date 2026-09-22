use anchor_lang::prelude::*;

use crate::{constants::BPS_DENOMINATOR, error::PixelVaultError};

/// `amount * bps / 10_000`, rounded down, without intermediate overflow.
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64> {
    let scaled = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(PixelVaultError::MathOverflow)?
        / BPS_DENOMINATOR;
    u64::try_from(scaled).map_err(|_| error!(PixelVaultError::MathOverflow))
}

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(error!(PixelVaultError::MathOverflow))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(error!(PixelVaultError::MathOverflow))
}

/// True when a cap is set (non-zero) and `value` would exceed it.
pub fn exceeds_cap(value: u64, cap: u64) -> bool {
    cap != 0 && value > cap
}
