use anchor_lang::prelude::*;

#[error_code]
pub enum PixelVaultError {
    #[msg("Backing ratio is outside the protocol band")]
    BackingRatioOutOfBand,
    #[msg("Backing can only be raised, never lowered")]
    BackingMustIncrease,
    #[msg("Mint price must be greater than zero")]
    InvalidPrice,
    #[msg("Vault balance is below the backing it owes")]
    VaultUndercollateralized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Crafting is paused")]
    CraftingPaused,
    #[msg("Signer is not authorised for this action")]
    Unauthorized,
    #[msg("Protocol fee exceeds the hard ceiling")]
    FeeTooHigh,
    #[msg("Game name is too long")]
    NameTooLong,
    #[msg("Expected an Ed25519 grant verification immediately before this instruction")]
    MissingGrant,
    #[msg("Material grant does not match this craft")]
    InvalidGrant,
    #[msg("Material grant has expired")]
    GrantExpired,
    #[msg("Material grant sequence number is already used or out of order")]
    GrantAlreadyUsed,
    #[msg("Item class supply cap reached")]
    SupplyCapReached,
    #[msg("Per-player backing cap reached")]
    PlayerCapReached,
    #[msg("Game backing cap reached")]
    GameCapReached,
    #[msg("Protocol backing cap reached")]
    ProtocolCapReached,
}
