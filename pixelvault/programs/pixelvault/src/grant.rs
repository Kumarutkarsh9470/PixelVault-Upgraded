//! Material grants: a game server's Ed25519 signature authorising one craft.
//!
//! The transaction carries an Ed25519 precompile instruction immediately before
//! `craft`. The runtime verifies the signature itself; this module checks that
//! the verified signature was made by the game's grant signer over exactly the
//! grant this craft claims.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{constants::GRANT_DOMAIN, error::PixelVaultError};

/// Offsets header of the Ed25519 precompile instruction data:
/// [num_signatures: u8, padding: u8, then one 14-byte offsets struct].
const OFFSETS_START: usize = 2;
const OFFSETS_LEN: usize = 14;
/// Instruction index meaning "data lives in this same precompile instruction".
const SELF_INSTRUCTION: u16 = u16::MAX;

/// The exact bytes a game server signs to authorise one craft.
pub fn grant_message(
    game: &Pubkey,
    class_id: u64,
    player: &Pubkey,
    seq: u64,
    expires_at: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(GRANT_DOMAIN.len() + 32 * 3 + 24);
    message.extend_from_slice(GRANT_DOMAIN);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(game.as_ref());
    message.extend_from_slice(&class_id.to_le_bytes());
    message.extend_from_slice(player.as_ref());
    message.extend_from_slice(&seq.to_le_bytes());
    message.extend_from_slice(&expires_at.to_le_bytes());
    message
}

pub fn verify_grant(instructions: &AccountInfo, signer: &Pubkey, message: &[u8]) -> Result<()> {
    let current = load_current_index_checked(instructions)? as usize;
    require!(current > 0, PixelVaultError::MissingGrant);

    let precompile = load_instruction_at_checked(current - 1, instructions)?;
    require_keys_eq!(
        precompile.program_id,
        solana_sdk_ids::ed25519_program::ID,
        PixelVaultError::MissingGrant
    );

    let data = &precompile.data;
    require!(
        data.len() >= OFFSETS_START + OFFSETS_LEN && data[0] == 1,
        PixelVaultError::InvalidGrant
    );
    let read_u16 = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]);
    let o = OFFSETS_START;
    let signature_ix = read_u16(o + 2);
    let pubkey_offset = read_u16(o + 4) as usize;
    let pubkey_ix = read_u16(o + 6);
    let message_offset = read_u16(o + 8) as usize;
    let message_len = read_u16(o + 10) as usize;
    let message_ix = read_u16(o + 12);

    // Everything the precompile verified must live inside the precompile
    // instruction itself, or an attacker could point it at unrelated bytes.
    require!(
        signature_ix == SELF_INSTRUCTION
            && pubkey_ix == SELF_INSTRUCTION
            && message_ix == SELF_INSTRUCTION,
        PixelVaultError::InvalidGrant
    );

    let signed_pubkey = data
        .get(pubkey_offset..pubkey_offset + 32)
        .ok_or(PixelVaultError::InvalidGrant)?;
    let signed_message = data
        .get(message_offset..message_offset + message_len)
        .ok_or(PixelVaultError::InvalidGrant)?;

    require!(signed_pubkey == signer.as_ref(), PixelVaultError::InvalidGrant);
    require!(signed_message == message, PixelVaultError::InvalidGrant);
    Ok(())
}
