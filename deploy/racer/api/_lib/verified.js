// Reading a verified run back off the chain.
//
// The program replays a player's inputs and emits what it derived. The game
// server trusts that, and nothing else: a run is rewarded because the chain
// agreed with it, not because a client said so.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import { rpc } from "./chain.js";

const chain = JSON.parse(fs.readFileSync(new URL("../../data/chain.json", import.meta.url)));

/// Anchor event discriminator: sha256("event:RunVerified")[..8].
const RUN_VERIFIED = Buffer.from([157, 178, 222, 154, 65, 111, 40, 97]);
const PROGRAM_DATA = "Program data: ";

/** The RunVerified event a transaction emitted, or null if it has none. */
export function parseRunVerified(logs) {
  for (const line of logs ?? []) {
    if (!line.startsWith(PROGRAM_DATA)) {
      continue;
    }
    const data = Buffer.from(line.slice(PROGRAM_DATA.length), "base64");
    if (data.length < 8 + 8 + 32 + 4 + 4 + 32 + 2 || !data.subarray(0, 8).equals(RUN_VERIFIED)) {
      continue;
    }
    let at = 8;
    const trackId = Number(data.readBigUInt64LE(at));
    at += 8;
    const player = new PublicKey(data.subarray(at, at + 32)).toBase58();
    at += 32;
    const totalMs = data.readUInt32LE(at);
    at += 4;
    const steps = data.readUInt32LE(at);
    at += 4;
    const traceHash = data.subarray(at, at + 32).toString("hex");
    at += 32;
    const rank = data.readUInt16LE(at);
    return { trackId, player, totalMs, steps, traceHash, rank };
  }
  return null;
}

/**
 * Confirms that `signature` is a transaction in which the program replayed
 * this player's run on this track, and returns what the chain derived.
 * Throws if anything about it fails to line up.
 */
export async function readVerifiedRun({ signature, wallet, trackId, trace }) {
  const expected = chain.tracks?.[trackId];
  if (!expected) {
    throw new Error(`${trackId} is not registered on-chain`);
  }

  const tx = await rpc().getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    throw new Error("that verification transaction is not on-chain");
  }
  if (tx.meta?.err) {
    throw new Error("that verification transaction failed");
  }

  const event = parseRunVerified(tx.meta?.logMessages);
  if (!event) {
    throw new Error("that transaction did not verify a run");
  }
  if (event.player !== wallet) {
    throw new Error("that run was verified for a different wallet");
  }
  if (event.trackId !== expected.trackId) {
    throw new Error("that run was verified on a different track");
  }
  const hash = createHash("sha256").update(Buffer.from(trace, "base64")).digest("hex");
  if (hash !== event.traceHash) {
    throw new Error("the inputs sent here are not the ones the chain replayed");
  }
  return event;
}
