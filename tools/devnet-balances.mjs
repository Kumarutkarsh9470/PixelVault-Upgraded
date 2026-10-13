// Shows what every devnet key holds, and can move spare SOL to the deploy
// wallet. Deploying the program needs roughly 2.4 SOL free at once, because
// the upload buffer must be rent-exempt for the size of the binary.
//
// Usage: node tools/devnet-balances.mjs            (report only)
//        node tools/devnet-balances.mjs --sweep    (send spare SOL to the admin)
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } =
  require("@solana/web3.js");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const SECRETS = new URL("../secrets/", import.meta.url);
const ADMIN_PATH = "\\\\wsl.localhost\\Ubuntu\\root\\.config\\solana\\id.json";
/// What each key keeps for its own fees when sweeping.
const KEEP = { "sponsor-devnet": 0.4 * LAMPORTS_PER_SOL, default: 0.02 * LAMPORTS_PER_SOL };

const connection = new Connection(RPC, "confirmed");
const readKey = (path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
const admin = readKey(ADMIN_PATH);
const sweep = process.argv.includes("--sweep");

const keys = fs
  .readdirSync(SECRETS)
  .filter((f) => f.endsWith(".json") && !f.startsWith("mint-"))
  .map((f) => ({ name: f.replace(/\.json$/, ""), key: readKey(new URL(f, SECRETS)) }));

console.log(`admin ${admin.publicKey.toBase58()}: ${(await connection.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);

for (const { name, key } of keys) {
  const balance = await connection.getBalance(key.publicKey);
  const keep = KEEP[name] ?? KEEP.default;
  const spare = balance - keep;
  console.log(`${name.padEnd(28)} ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL` + (spare > 0 ? ` (${(spare / LAMPORTS_PER_SOL).toFixed(4)} spare)` : ""));

  if (sweep && spare > 0.01 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: key.publicKey,
        toPubkey: new PublicKey(admin.publicKey),
        lamports: spare - 5000,
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [key], { commitment: "confirmed" });
    console.log(`  swept to admin: ${signature.slice(0, 16)}…`);
  }
}

console.log(`admin now: ${(await connection.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);
