// Fee-payer relayer. GET returns what a client needs to build a sponsored
// transaction; POST verifies a player-signed transaction, co-signs it as fee
// payer and submits it. Players never need to hold SOL.
import { createHash } from "node:crypto";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

const PIXELVAULT_PROGRAM = "AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

// Only these programs may appear in a sponsored transaction.
const SPONSORED_PROGRAMS = new Set([
  PIXELVAULT_PROGRAM,
  MEMO_PROGRAM,
  ED25519_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
]);

// Replaying a race needs a raised compute limit, so the Compute Budget program
// is allowed, but only to raise the limit. Setting a priority fee (tag 3) is
// refused: the sponsor pays the fees, and a client could otherwise make one
// transaction cost whatever it liked.
const SET_COMPUTE_UNIT_LIMIT = 2;
const MAX_COMPUTE_UNITS = 1_400_000;

const discriminator = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/**
 * Where the sponsor's own key may appear, by instruction. The program decides
 * what it does with that role; this only limits which roles are on offer.
 *   craft      account 1: rent_payer for a newly minted item
 *   open_run   account 0: payer for the buffer a run is verified in
 *   close_run  account 2: where that buffer's rent goes back to
 */
const SPONSOR_ROLES = [
  { name: "craft", position: 1 },
  { name: "open_run", position: 0 },
  { name: "close_run", position: 2 },
].map((role) => ({ ...role, discriminator: discriminator(role.name) }));

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

/** The role the sponsor may take in this instruction, if any. */
function sponsorPosition(data) {
  if (data.length < 8) {
    return null;
  }
  const head = Buffer.from(data.subarray(0, 8));
  const role = SPONSOR_ROLES.find((r) => head.equals(r.discriminator));
  return role ? role.position : null;
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

/** Returns why a transaction must not be sponsored, or null if it is safe. */
export function rejectReason(tx, sponsor) {
  const message = tx.message;
  const keys = message.staticAccountKeys;

  if (message.addressTableLookups && message.addressTableLookups.length > 0) {
    return "address lookup tables are not sponsored";
  }
  if (!keys[0].equals(sponsor)) {
    return "fee payer must be the sponsor";
  }

  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex].toBase58();
    if (!SPONSORED_PROGRAMS.has(program)) {
      return `program ${program} is not sponsored`;
    }
    if (program === COMPUTE_BUDGET_PROGRAM) {
      const reason = rejectComputeBudget(ix.data);
      if (reason) {
        return reason;
      }
      continue;
    }

    const allowedPosition = program === PIXELVAULT_PROGRAM ? sponsorPosition(ix.data) : null;
    for (const [position, keyIndex] of ix.accountKeyIndexes.entries()) {
      if (keyIndex === 0 && position !== allowedPosition) {
        return "the sponsor may only pay rent and fees, never act as a player";
      }
    }
  }

  for (let i = 1; i < message.header.numRequiredSignatures; i++) {
    if (tx.signatures[i].every((b) => b === 0)) {
      return "transaction is missing a required player signature";
    }
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const sponsor = feePayer();
    const connection = new Connection(RPC_URL, "confirmed");

    if (req.method === "GET") {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      return res.status(200).json({
        feePayer: sponsor.publicKey.toBase58(),
        blockhash,
        lastValidBlockHeight,
      });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.transaction !== "string") {
      return res.status(400).json({ error: "expected { transaction: base64 }" });
    }
    const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));

    let reason;
    try {
      reason = rejectReason(tx, sponsor.publicKey);
    } catch (e) {
      reason = e.message;
    }
    if (reason) {
      return res.status(400).json({ error: reason });
    }

    tx.sign([sponsor]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, "confirmed");
    return res.status(200).json({ signature });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
