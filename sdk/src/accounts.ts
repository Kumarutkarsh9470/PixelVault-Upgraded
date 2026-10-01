import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
} from "@solana/kit";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
export const ED25519_PROGRAM = address("Ed25519SigVerify111111111111111111111111111");
export const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const text = new TextEncoder();
const addressEncoder = getAddressEncoder();

export const addressBytes = (value: Address) => new Uint8Array(addressEncoder.encode(value));
const u64Bytes = (value: number | bigint) => new Uint8Array(getU64Encoder().encode(BigInt(value)));

export async function gamePda(programId: Address, gameId: number | bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [text.encode("game"), u64Bytes(gameId)],
  });
  return pda;
}

export async function playerStatePda(programId: Address, game: Address, player: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [text.encode("player"), addressBytes(game), addressBytes(player)],
  });
  return pda;
}

export async function associatedTokenAddress(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addressBytes(owner), addressBytes(tokenProgram), addressBytes(mint)],
  });
  return pda;
}

/**
 * PlayerState layout: 8-byte discriminator, game (32), player (32),
 * next_grant_seq (u64), total_backed_crafted (u64), bump (u8).
 */
export const PLAYER_STATE_NEXT_SEQ_OFFSET = 8 + 32 + 32;
