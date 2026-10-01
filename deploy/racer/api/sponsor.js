// Fee-payer relayer. GET returns what a client needs to build a sponsored
// transaction; POST verifies a player-signed transaction, co-signs it as fee
// payer and submits it. Players never need to hold SOL.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { sql } from "./_lib/db.js";
import { HttpError, readBody, route } from "./_lib/http.js";
import { verifyInitData } from "./_lib/telegram.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));
const RPC_URL = process.env.RPC_URL || chain.rpc;

const PIXELVAULT_PROGRAM = chain.programId;
const USDC_MINT = chain.usdcMint;
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Only these programs may appear in a sponsored transaction. The Compute
// Budget program is deliberately absent: it would let a client attach an
// arbitrary priority fee that the sponsor pays.
const SPONSORED_PROGRAMS = new Set([PIXELVAULT_PROGRAM, MEMO_PROGRAM, ED25519_PROGRAM, TOKEN_PROGRAM]);

const discriminator = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const CRAFT = discriminator("craft");
const REDEEM = discriminator("redeem");
// In `craft`, account 1 is `rent_payer`: the only role the sponsor may play in
// any instruction. The program itself limits what rent it pays for.
const RENT_PAYER_POSITION = 1;

const TRANSFER_CHECKED = 12;
/** Smallest sponsored withdrawal: $0.10, so dust transfers cannot burn fees. */
export const MIN_WITHDRAW = 100_000n;

/** Per-wallet limits on sponsored transactions. */
export const RATE_LIMITS = [
  { interval: "10 minutes", max: 20 },
  { interval: "1 day", max: 150 },
];

let cachedFeePayer;

function feePayer() {
  if (!cachedFeePayer) {
    const raw = process.env.SPONSOR_SECRET_KEY;
    if (!raw) {
      throw new Error("SPONSOR_SECRET_KEY is not set");
    }
    cachedFeePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return cachedFeePayer;
}

const startsWith = (data, prefix) => data.length >= prefix.length && Buffer.from(data.subarray(0, prefix.length)).equals(prefix);

/**
 * Checks a transaction against everything the sponsor is willing to pay for.
 * Returns { kind } when it is safe, or { reason } when it must be refused.
 * `player` is the wallet linked to the caller's Telegram account.
 */
export function inspect(tx, sponsor, player) {
  const message = tx.message;
  const keys = message.staticAccountKeys;
  const refuse = (reason) => ({ reason });

  if (message.addressTableLookups && message.addressTableLookups.length > 0) {
    return refuse("address lookup tables are not sponsored");
  }
  if (!keys[0].equals(sponsor)) {
    return refuse("fee payer must be the sponsor");
  }
  if (message.header.numRequiredSignatures !== 2 || !keys[1].equals(player)) {
    return refuse("the only signer besides the sponsor must be your wallet");
  }
  if (tx.signatures[1].every((b) => b === 0)) {
    return refuse("transaction is missing your signature");
  }

  const seen = { craft: 0, redeem: 0, withdraw: 0 };
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex].toBase58();
    if (!SPONSORED_PROGRAMS.has(program)) {
      return refuse(`program ${program} is not sponsored`);
    }
    const isCraft = program === PIXELVAULT_PROGRAM && startsWith(ix.data, CRAFT);

    for (const [position, keyIndex] of ix.accountKeyIndexes.entries()) {
      if (keyIndex === 0 && !(isCraft && position === RENT_PAYER_POSITION)) {
        return refuse("instructions may only use the sponsor as the rent payer of craft");
      }
    }

    if (program === PIXELVAULT_PROGRAM) {
      if (isCraft) seen.craft++;
      else if (startsWith(ix.data, REDEEM)) seen.redeem++;
      else return refuse("only craft and redeem are sponsored");
    } else if (program === TOKEN_PROGRAM) {
      // TransferChecked: [source, mint, destination, authority], data = [12, amount u64, decimals u8].
      if (ix.data.length !== 10 || ix.data[0] !== TRANSFER_CHECKED || ix.accountKeyIndexes.length !== 4) {
        return refuse("only USDC TransferChecked is sponsored");
      }
      const [, mintIndex, , authorityIndex] = ix.accountKeyIndexes;
      if (keys[mintIndex].toBase58() !== USDC_MINT) {
        return refuse("only USDC transfers are sponsored");
      }
      if (!keys[authorityIndex].equals(player)) {
        return refuse("you can only withdraw your own USDC");
      }
      if (Buffer.from(ix.data).readBigUInt64LE(1) < MIN_WITHDRAW) {
        return refuse("withdrawals under $0.10 are not sponsored");
      }
      seen.withdraw++;
    }
  }

  const kinds = Object.entries(seen).filter(([, n]) => n > 0).map(([kind]) => kind);
  if (kinds.length === 0) return refuse("nothing to sponsor");
  if (seen.withdraw > 0 && kinds.length > 1) return refuse("withdrawals must be sent on their own");
  if (seen.craft > 1 || seen.redeem > 1) return refuse("one craft and one redeem per transaction");
  return { kind: seen.craft && seen.redeem ? "route" : kinds[0] };
}

export default route(["GET", "POST"], async (req) => {
  const sponsor = feePayer();
  const connection = new Connection(RPC_URL, "confirmed");

  if (req.method === "GET") {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    return { feePayer: sponsor.publicKey.toBase58(), blockhash, lastValidBlockHeight };
  }

  const body = readBody(req);
  const user = verifyInitData(body.initData);
  if (typeof body.transaction !== "string") {
    throw new HttpError(400, "expected { transaction: base64 }");
  }
  const [player] = await sql()`select wallet from players where telegram_id = ${user.id}`;
  if (!player?.wallet) {
    throw new HttpError(403, "open the game once to link your wallet");
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
  const verdict = inspect(tx, sponsor.publicKey, new PublicKey(player.wallet));
  if (verdict.reason) {
    throw new HttpError(400, verdict.reason);
  }

  for (const { interval, max } of RATE_LIMITS) {
    const [{ n }] = await sql()`
      select count(*)::int as n from sponsored_txs
      where wallet = ${player.wallet} and created_at > now() - ${interval}::interval`;
    if (n >= max) {
      throw new HttpError(429, "too many transactions; try again later");
    }
  }

  tx.sign([sponsor]);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await sql()`
    insert into sponsored_txs (signature, wallet, kind) values (${signature}, ${player.wallet}, ${verdict.kind})
    on conflict (signature) do nothing`;
  await connection.confirmTransaction(signature, "confirmed");
  return { signature };
});
