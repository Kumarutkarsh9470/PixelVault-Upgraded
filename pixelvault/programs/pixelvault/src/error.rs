use anchor_lang::prelude::*;

#[error_code]
pub enum PixelVaultError {
    #[msg("Backing ratio is outside the protocol band")]
    BackingRatioOutOfBand,
    #[msg("Mint price must be greater than zero")]
    InvalidPrice,
    #[msg("Vault balance is below the backing it owes")]
    VaultUndercollateralized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Crafting is paused for this game")]
    CraftingPaused,
}
