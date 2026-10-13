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
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

// Only these programs may appear in a sponsored transaction.
const SPONSORED_PROGRAMS = new Set([PIXELVAULT_PROGRAM, MEMO_PROGRAM, ED25519_PROGRAM, TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM]);

// Replaying a race needs a raised compute limit, so the Compute Budget program
// is allowed, but only to raise the limit. Setting a priority fee (tag 3) is
// refused: the sponsor pays the fees, and a client could otherwise make one
// transaction cost whatever it liked.
const SET_COMPUTE_UNIT_LIMIT = 2;
const MAX_COMPUTE_UNITS = 1_400_000;

const discriminator = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/**
 * What the sponsor pays for in PixelVault, and where its own key may appear.
 * The program decides what it does with that role; this only limits which
 * roles are on offer.
 *   craft      account 1: rent_payer for a newly minted item
 *   open_run   account 0: payer for the buffer a run is verified in
 *   close_run  account 2: where that buffer's rent goes back to
 */
const INSTRUCTIONS = [
  { name: "craft", kind: "craft", sponsorPosition: 1 },
  { name: "redeem", kind: "redeem", sponsorPosition: null },
  { name: "open_run", kind: "verify", sponsorPosition: 0 },
  { name: "write_run", kind: "verify", sponsorPosition: null },
  { name: "verify_run", kind: "verify", sponsorPosition: null },
  { name: "close_run", kind: "verify", sponsorPosition: 2 },
].map((ix) => ({ ...ix, discriminator: discriminator(ix.name) }));

const TRANSFER_CHECKED = 12;
/** Smallest sponsored withdrawal: $0.10, so dust transfers cannot burn fees. */
export const MIN_WITHDRAW = 100_000n;

/** Per-wallet limits on sponsored transactions. Verifying one race takes about seven. */
export const RATE_LIMITS = [
  { interval: "10 minutes", max: 60 },
  { interval: "1 day", max: 400 },
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

/** Which PixelVault instruction this is, if it is one the sponsor pays for. */
function pixelvaultInstruction(data) {
  if (data.length < 8) return null;
  const head = Buffer.from(data.subarray(0, 8));
  return INSTRUCTIONS.find((ix) => head.equals(ix.discriminator)) ?? null;
}

/** Why a compute budget instruction must not be sponsored, or null. */
function rejectComputeBudget(data) {
  if (data.length < 1 || data[0] !== SET_COMPUTE_UNIT_LIMIT) {
    return "only a compute unit limit may be sponsored";
  }
  if (data.length !== 5) {
    return "malformed compute unit limit";
  }
  const units = Buffer.from(data).readUInt32LE(1);
  if (units > MAX_COMPUTE_UNITS) {
    return `compute unit limit ${units} is above the ceiling`;
  }
  return null;
}

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

  const seen = { craft: 0, redeem: 0, withdraw: 0, verify: 0 };
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex].toBase58();
    if (!SPONSORED_PROGRAMS.has(program)) {
      return refuse(`program ${program} is not sponsored`);
    }
    if (program === COMPUTE_BUDGET_PROGRAM) {
      const reason = rejectComputeBudget(ix.data);
      if (reason) return refuse(reason);
      continue;
    }

    const pv = program === PIXELVAULT_PROGRAM ? pixelvaultInstruction(ix.data) : null;
    if (program === PIXELVAULT_PROGRAM && !pv) {
      return refuse("only craft, redeem and run verification are sponsored");
    }
    for (const [position, keyIndex] of ix.accountKeyIndexes.entries()) {
      if (keyIndex === 0 && position !== pv?.sponsorPosition) {
        return refuse("the sponsor may only pay rent and fees, never act as a player");
      }
    }

    if (pv) {
      seen[pv.kind]++;
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
  if (seen.verify > 0 && (seen.craft > 0 || seen.redeem > 0)) return refuse("run verification must be sent on its own");
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
