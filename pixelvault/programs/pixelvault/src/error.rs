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
    #[msg("Track definition is invalid")]
    InvalidTrack,
    #[msg("Track geometry is frozen")]
    TrackFrozen,
    #[msg("Track must be frozen before runs can be verified")]
    TrackNotFrozen,
    #[msg("Run trace is malformed")]
    MalformedTrace,
    #[msg("Run trace is longer than the simulation allows")]
    TraceTooLong,
    #[msg("These inputs never finished the race")]
    RunNeverFinished,
    #[msg("The run finished before the end of the trace")]
    RunFinishedEarly,
    #[msg("Verification has already started for this run")]
    RunAlreadyStarted,
    #[msg("This run has already been verified")]
    RunAlreadyVerified,
    #[msg("The trace has not been fully uploaded")]
    TraceIncomplete,
}

impl From<crate::sim::SimError> for PixelVaultError {
    fn from(error: crate::sim::SimError) -> Self {
        match error {
            crate::sim::SimError::MalformedTrace => PixelVaultError::MalformedTrace,
            crate::sim::SimError::TraceTooLong => PixelVaultError::TraceTooLong,
            crate::sim::SimError::NeverFinished => PixelVaultError::RunNeverFinished,
            crate::sim::SimError::FinishedEarly => PixelVaultError::RunFinishedEarly,
        }
    }
}
