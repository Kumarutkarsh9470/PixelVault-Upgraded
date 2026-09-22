// End-to-end check of the whole economy on devnet, using the app's real
// transaction builders (src/lib/program.ts) and the backend's real grant
// signer, with a throwaway zero-SOL player standing in for a Privy wallet:
//   starter USDC -> craft (sponsored) -> redeem -> craft -> route to Game B.
// Requires the local server (tools/serve-web.mjs) for the relayer.
// Usage: npx tsx scripts/e2e-devnet.ts [baseUrl]
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type Instruction,
} from "@solana/kit";

import { balancesOf, classConfig, compileSponsored, craftInstructions, redeemInstruction, chain } from "../src/lib/program";
import catalog from "../src/data/catalog.json";

const base = process.argv[2] || "http://localhost:8091";
const secret = (name: string) => fs.readFileSync(new URL(`../../secrets/${name}.json`, import.meta.url), "utf8").trim();
process.env.GRANT_SIGNER_SECRET = secret("grant-signer-devnet");

const server = await import("../../deploy/racer/api/_lib/chain.js");
const require = createRequire(new URL("../../deploy/racer/package.json", import.meta.url));
const web3 = require("@solana/web3.js");

const item = (gameId: number, classId: number) => {
  const found = catalog.games.find((g) => g.gameId === gameId)!.items.find((i) => i.classId === classId)!;
  return { ...found, gameId };
};

async function mintStarterUsdc(owner: string, amount: number) {
  const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret("funder-devnet"))));
  const connection = new web3.Connection(chain.rpc, "confirmed");
  const TOKEN = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ATA = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const mint = new web3.PublicKey(chain.usdcMint);
  const ownerKey = new web3.PublicKey(owner);
  const [account] = web3.PublicKey.findProgramAddressSync([ownerKey.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA);
  const data = Buffer.alloc(9);
  data[0] = 7;
  data.writeBigUInt64LE(BigInt(amount), 1);
  const tx = new web3.Transaction().add(
    new web3.TransactionInstruction({
      programId: ATA,
      keys: [
        { pubkey: funder.publicKey, isSigner: true, isWritable: true },
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: ownerKey, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    }),
    new web3.TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: funder.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    }),
  );
  await web3.sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
}

async function grantFor(player: string, gameId: number, classId: number) {
  const seq = await server.nextGrantSeq(gameId, player);
  const expiresAt = Math.floor(Date.now() / 1000) + server.GRANT_TTL_SECONDS;
  const { signer, signature } = server.signGrant(server.grantMessage(gameId, classId, player, seq, expiresAt));
  const it = item(gameId, classId);
  return { gameId, classId, seq: seq.toString(), expiresAt, signer, signature, price: it.price, backingBps: it.backingBps };
}

async function sponsored(signerKeys: CryptoKeyPair, build: (feePayer: string) => Promise<Instruction[]>) {
  const quote = await fetch(`${base}/api/sponsor`).then((r) => r.json());
  const bytes = compileSponsored(await build(quote.feePayer), quote);
  console.log(`  transaction size: ${bytes.length} bytes (limit 1232)`);
  const signed = await partiallySignTransaction([signerKeys], getTransactionDecoder().decode(bytes));
  const response = await fetch(`${base}/api/sponsor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: getBase64EncodedWireTransaction(signed) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`relayer refused: ${body.error}`);
  return body.signature as string;
}

const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — ${detail}`);
  if (!ok) process.exitCode = 1;
};

const player = await generateKeyPairSigner();
console.log("player", player.address, "(holds 0 SOL throughout)");

await mintStarterUsdc(player.address, 2_000_000);
let balances = await balancesOf(player.address);
check("starter USDC", balances.usdc === 2_000_000, `${balances.usdc}`);

// 1. Craft Cyan Pulse ($0.30, 70% backed).
const glow = item(1, 10);
const glowMint = classConfig(1, 10).mint;
let sig = await sponsored(player.keyPair, async (feePayer) =>
  craftInstructions(player.address, feePayer as never, await grantFor(player.address, 1, 10)),
);
console.log("  craft", explorer(sig));
balances = await balancesOf(player.address);
check("craft minted the item", balances.items[glowMint] === 1, `${balances.items[glowMint] ?? 0}`);
check("craft charged the price", balances.usdc === 2_000_000 - glow.price, `${balances.usdc}`);

// 2. Redeem it: exactly the backing comes back.
const backing = Math.floor((glow.price * glow.backingBps) / 10_000);
sig = await sponsored(player.keyPair, async () => [await redeemInstruction(player.address, 1, 10)]);
console.log("  redeem", explorer(sig));
balances = await balancesOf(player.address);
check("redeem burned the item", (balances.items[glowMint] ?? 0) === 0, `${balances.items[glowMint] ?? 0}`);
check("redeem returned the backing", balances.usdc === 2_000_000 - glow.price + backing, `${balances.usdc}`);

// 3. Craft again, then route it into Glyph Forge in one transaction.
sig = await sponsored(player.keyPair, async (feePayer) =>
  craftInstructions(player.address, feePayer as never, await grantFor(player.address, 1, 10)),
);
console.log("  craft again", explorer(sig));
const frame = item(2, 1);
const frameMint = classConfig(2, 1).mint;
const before = (await balancesOf(player.address)).usdc;
sig = await sponsored(player.keyPair, async (feePayer) => [
  await redeemInstruction(player.address, 1, 10),
  ...(await craftInstructions(player.address, feePayer as never, await grantFor(player.address, 2, 1))),
]);
console.log("  route", explorer(sig));
balances = await balancesOf(player.address);
check("route burned the racer item", (balances.items[glowMint] ?? 0) === 0, `${balances.items[glowMint] ?? 0}`);
check("route minted the Glyph Forge frame", balances.items[frameMint] === 1, `${balances.items[frameMint] ?? 0}`);
check("route charged only the difference", balances.usdc === before + backing - frame.price, `${before} -> ${balances.usdc}`);

const stats = await fetch(`${base}/api/stats`).then((r) => r.json());
check("vaults solvent on-chain", stats.solvent === true, `total backed ${stats.totalBacked}`);
