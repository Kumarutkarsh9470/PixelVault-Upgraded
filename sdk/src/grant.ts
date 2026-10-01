import { getI64Encoder, getU64Encoder, type Address } from "@solana/kit";

import { addressBytes } from "./accounts.ts";

/** Must match `GRANT_DOMAIN` in the program's constants.rs. */
export const GRANT_DOMAIN = "PIXELVAULT_GRANT_V2";

/** A game server's signed permission for one craft, as sent to the client. */
export type Grant = {
  gameId: number;
  classId: number;
  /** The player's on-chain grant sequence number this grant consumes (u64, as a decimal string). */
  seq: string;
  /** Unix seconds; the program rejects the grant after this. */
  expiresAt: number;
  /** Base58 address of the game's grant signer. */
  signer: string;
  /** Base64 Ed25519 signature over `grantMessage(...)`. */
  signature: string;
};

export type GrantFields = {
  programId: Address;
  game: Address;
  classId: number | bigint;
  player: Address;
  seq: bigint;
  expiresAt: number | bigint;
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** The 32 bytes a grant signer signs: byte-for-byte what `grant::grant_message` hashes on-chain. */
export async function grantMessage(fields: GrantFields): Promise<Uint8Array> {
  const bytes = concat([
    new TextEncoder().encode(GRANT_DOMAIN),
    addressBytes(fields.programId),
    addressBytes(fields.game),
    new Uint8Array(getU64Encoder().encode(BigInt(fields.classId))),
    addressBytes(fields.player),
    new Uint8Array(getU64Encoder().encode(fields.seq)),
    new Uint8Array(getI64Encoder().encode(BigInt(fields.expiresAt))),
  ]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
