// Fee-payer relayer. GET returns what a client needs to build a sponsored
// transaction; POST verifies a player-signed transaction, co-signs it as fee
// payer and submits it. Players never need to hold SOL.
import { createHash } from "node:crypto";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

const PIXELVAULT_PROGRAM = "AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";

// Only these programs may appear in a sponsored transaction. The Compute
// Budget program is deliberately absent: it would let a client attach an
// arbitrary priority fee that the sponsor pays.
const SPONSORED_PROGRAMS = new Set([PIXELVAULT_PROGRAM, MEMO_PROGRAM, ED25519_PROGRAM]);

// In `craft`, account 1 is `rent_payer`: the only role the sponsor may play in
// any instruction. The program itself limits what rent it pays for.
const CRAFT_DISCRIMINATOR = createHash("sha256").update("global:craft").digest().subarray(0, 8);
const RENT_PAYER_POSITION = 1;

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

function isCraft(data) {
  return data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(CRAFT_DISCRIMINATOR);
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

    ix.accountKeyIndexes.forEach((keyIndex, position) => {
      if (keyIndex !== 0) {
        return;
      }
      const allowed =
        program === PIXELVAULT_PROGRAM && isCraft(ix.data) && position === RENT_PAYER_POSITION;
      if (!allowed) {
        throw new Error("instructions may only use the sponsor as the rent payer of craft");
      }
    });
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
