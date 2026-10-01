// End-to-end check of the relayer against devnet through a running server,
// using a throwaway Telegram identity and wallet in place of a real player.
// Needs the server's TELEGRAM_BOT_TOKEN to sign launch data, and FUNDER_SECRET
// on the server so the starter grant gives the wallet USDC to withdraw.
// Usage: TELEGRAM_BOT_TOKEN=... node tools/test-sponsor.mjs [baseUrl]   (default http://localhost:8091)
import { createHmac } from "node:crypto";
import fs from "node:fs";
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
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required to sign test launch data");
  process.exit(1);
}
const chain = JSON.parse(fs.readFileSync(new URL("../web/src/data/chain.json", import.meta.url)));
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDC = new PublicKey(chain.usdcMint);

/** Launch data exactly as Telegram signs it, for a made-up user. */
function initDataFor(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: "Relayer Test" }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function call(path, body) {
  const r = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

function build(q, signer, instructions) {
  const message = new TransactionMessage({
    payerKey: new PublicKey(q.feePayer),
    recentBlockhash: q.blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  return Buffer.from(tx.serialize()).toString("base64");
}

const usdcAccount = (owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), USDC.toBuffer()], ATA)[0];

function transferChecked(owner, destination, amount) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  return new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: usdcAccount(owner), isSigner: false, isWritable: true },
      { pubkey: USDC, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

const player = Keypair.generate();
const initData = initDataFor(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
const results = [];
const expect = (name, response, status) => {
  const pass = response.status === status;
  results.push(pass);
  console.log(pass ? "pass" : "FAIL", name, response.status, response.body.error ?? response.body.signature ?? "");
};

const session = await call("/api/session", { initData, wallet: player.publicKey.toBase58() });
expect("link throwaway wallet", session, 200);
const starter = await call("/api/starter", { initData, wallet: player.publicKey.toBase58() });
expect("starter USDC", starter, 200);

const { body: q } = await call("/api/sponsor");
console.log("sponsor:", q.feePayer);
const submit = (instructions, signer = player, auth = initData) =>
  call("/api/sponsor", { initData: auth, transaction: build(q, signer, instructions) });

// A withdrawal of the player's own USDC is sponsored (to their own account, so nothing leaves the test).
const self = usdcAccount(player.publicKey);
expect("withdraw $0.10", await submit([transferChecked(player.publicKey, self, 100_000n)]), 200);

expect("no Telegram login", await submit([transferChecked(player.publicKey, self, 100_000n)], player, ""), 401);
expect("withdraw under $0.10", await submit([transferChecked(player.publicKey, self, 99_999n)]), 400);

const memo = new TransactionInstruction({
  programId: MEMO,
  keys: [{ pubkey: player.publicKey, isSigner: true, isWritable: false }],
  data: Buffer.from("PixelVault relayer test"),
});
expect("memo only", await submit([memo]), 400);

const drain = SystemProgram.transfer({ fromPubkey: new PublicKey(q.feePayer), toPubkey: player.publicKey, lamports: 1_000_000 });
expect("drain the sponsor", await submit([transferChecked(player.publicKey, self, 100_000n), drain]), 400);

const priority = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000 });
expect("priority fee", await submit([priority, transferChecked(player.publicKey, self, 100_000n)]), 400);

const stranger = Keypair.generate();
expect("someone else's wallet", await submit([transferChecked(stranger.publicKey, self, 100_000n)], stranger), 400);

const passed = results.every(Boolean);
console.log(passed ? "PASS" : "FAIL");
process.exit(passed ? 0 : 1);
