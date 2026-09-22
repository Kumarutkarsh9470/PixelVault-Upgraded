// End-to-end check of the relayer against devnet, using a throwaway player
// keypair in place of the Privy wallet.
// Usage: node tools/test-sponsor.mjs [baseUrl]   (default http://localhost:8091)
import { createRequire } from "node:module";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require("@solana/web3.js");

const base = process.argv[2] || "http://localhost:8091";
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function quote() {
  const r = await fetch(`${base}/api/sponsor`);
  if (!r.ok) throw new Error(`GET failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function submit(tx) {
  const r = await fetch(`${base}/api/sponsor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: Buffer.from(tx.serialize()).toString("base64") }),
  });
  return { status: r.status, body: await r.json() };
}

function build(q, player, instructions) {
  const message = new TransactionMessage({
    payerKey: new PublicKey(q.feePayer),
    recentBlockhash: q.blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([player]);
  return tx;
}

const player = Keypair.generate();
const q = await quote();
console.log("sponsor:", q.feePayer);

// 1. A memo signed by a player with zero SOL should be sponsored.
const memo = new TransactionInstruction({
  programId: MEMO,
  keys: [{ pubkey: player.publicKey, isSigner: true, isWritable: false }],
  data: Buffer.from("PixelVault relayer test"),
});
const ok = await submit(build(q, player, [memo]));
console.log("sponsored memo:", ok.status, ok.body);

// 2. A legitimate-looking memo with a transfer out of the sponsor slipped in
// beside it must be refused.
const drain = SystemProgram.transfer({
  fromPubkey: new PublicKey(q.feePayer),
  toPubkey: player.publicKey,
  lamports: 1_000_000,
});
const bad = await submit(build(q, player, [memo, drain]));
console.log("drain attempt:", bad.status, bad.body);

// 3. A huge priority fee the sponsor would pay must be refused.
const priority = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000 });
const fee = await submit(build(q, player, [priority, memo]));
console.log("priority-fee attempt:", fee.status, fee.body);

// 4. The sponsor may not appear as an account anywhere except craft's rent payer.
const sponsorInMemo = new TransactionInstruction({
  programId: MEMO,
  keys: [
    { pubkey: player.publicKey, isSigner: true, isWritable: false },
    { pubkey: new PublicKey(q.feePayer), isSigner: true, isWritable: true },
  ],
  data: Buffer.from("sponsor misuse"),
});
const misuse = await submit(build(q, player, [sponsorInMemo]));
console.log("sponsor-as-account attempt:", misuse.status, misuse.body);

const passed =
  ok.status === 200 &&
  !!ok.body.signature &&
  bad.status === 400 &&
  fee.status === 400 &&
  misuse.status === 400;
console.log(passed ? "PASS" : "FAIL");
process.exit(passed ? 0 : 1);
