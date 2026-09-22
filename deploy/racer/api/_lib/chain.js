// On-chain reads and grant signing for the game server.
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

export const PROGRAM_ID = new PublicKey("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");
const GRANT_DOMAIN = Buffer.from("PIXELVAULT_GRANT_V2");
/** How long a signed grant stays valid, in seconds. */
export const GRANT_TTL_SECONDS = 180;

let connection;
export function rpc() {
  connection ??= new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  return connection;
}

const u64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
};
const i64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
};

export function gamePda(gameId) {
  return PublicKey.findProgramAddressSync([Buffer.from("game"), u64(gameId)], PROGRAM_ID)[0];
}

export function playerStatePda(game, player) {
  return PublicKey.findProgramAddressSync([Buffer.from("player"), game.toBuffer(), player.toBuffer()], PROGRAM_ID)[0];
}

/**
 * The player's next unused grant sequence number, read from the chain.
 * PlayerState layout: 8-byte discriminator, game (32), player (32),
 * next_grant_seq (u64), total_backed_crafted (u64), bump (u8).
 */
export async function nextGrantSeq(gameId, wallet) {
  const account = await rpc().getAccountInfo(playerStatePda(gamePda(gameId), new PublicKey(wallet)));
  if (!account) {
    return 0n;
  }
  return account.data.readBigUInt64LE(8 + 32 + 32);
}

/** Byte-for-byte the digest `grant::grant_message` builds on-chain. */
export function grantMessage(gameId, classId, wallet, seq, expiresAt) {
  const fields = Buffer.concat([
    GRANT_DOMAIN,
    PROGRAM_ID.toBuffer(),
    gamePda(gameId).toBuffer(),
    u64(classId),
    new PublicKey(wallet).toBuffer(),
    u64(seq),
    i64(expiresAt),
  ]);
  return createHash("sha256").update(fields).digest();
}

let signer;
function grantSigner() {
  if (!signer) {
    const raw = process.env.GRANT_SIGNER_SECRET;
    if (!raw) {
      throw new Error("GRANT_SIGNER_SECRET is not set");
    }
    signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return signer;
}

export function signGrant(message) {
  const key = grantSigner();
  return {
    signer: key.publicKey.toBase58(),
    signature: Buffer.from(nacl.sign.detached(message, key.secretKey)).toString("base64"),
  };
}
