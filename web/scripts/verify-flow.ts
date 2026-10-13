// Drives the client's on-chain verification against a local validator: the
// same module the game uses, with a local keypair standing in for the Privy
// wallet and the relayer.
//
// Proves the transactions the client builds are the ones the program accepts,
// without spending devnet SOL.
//
// Usage: tools/wsl/local-validator.sh start
//        npx tsx web/scripts/verify-flow.ts
import fs from "node:fs";
import { createRequire } from "node:module";

import { createSolanaRpc, type Instruction } from "@solana/kit";

import circuits from "../src/data/circuits.json";
import rivals from "../src/data/rivals.json";
import { runPda, verifyRunOnChain, type TrackChain } from "../src/lib/verify";

const require = createRequire(new URL("../../deploy/racer/package.json", import.meta.url));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const { createHash } = require("node:crypto");

const URL_LOCAL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM = new PublicKey("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");
const TRACK_ID = 1;
const TRACK = "neon-harbor";
const SAMPLES_PER_TX = 60;

const connection = new Connection(URL_LOCAL, "confirmed");
const kitRpc = createSolanaRpc(URL_LOCAL);
const circuit = (circuits as Record<string, any>)[TRACK];
const rival = (rivals as Record<string, any>)[TRACK];

const discriminator = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];

async function registerCircuit(admin: InstanceType<typeof Keypair>) {
  const track = pda([Buffer.from("track"), u64(TRACK_ID)]);
  const leaderboard = pda([Buffer.from("board"), u64(TRACK_ID)]);
  if (await connection.getAccountInfo(track)) {
    return { track, leaderboard };
  }

  const name = Buffer.from(TRACK, "utf8");
  const args = Buffer.concat([
    u32(name.length),
    name,
    Buffer.from([circuit.laps]),
    i32(circuit.spacing),
    i32(circuit.wallOffset),
    u16(circuit.startSample),
    u32(circuit.startHeading),
    u16(circuit.sampleCount),
    u32(circuit.checkpoints.length),
    ...circuit.checkpoints.map(u16),
    u32(circuit.padSamples.length),
    ...circuit.padSamples.map((s: number, i: number) => Buffer.concat([u16(s), i32(circuit.padLaterals[i])])),
  ]);

  const send = (ix: InstanceType<typeof TransactionInstruction>) =>
    sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], { commitment: "confirmed" });

  await send(
    new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: track, isSigner: false, isWritable: true },
        { pubkey: leaderboard, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([discriminator("init_track"), u64(TRACK_ID), args]),
    }),
  );

  for (let offset = 0; offset < circuit.sampleCount; offset += SAMPLES_PER_TX) {
    const end = Math.min(offset + SAMPLES_PER_TX, circuit.sampleCount);
    const data = Buffer.concat(circuit.samples.slice(offset * 4, end * 4).map(i32));
    await send(
      new TransactionInstruction({
        programId: PROGRAM,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          { pubkey: track, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([discriminator("write_track_samples"), u16(offset), u32(data.length), data]),
      }),
    );
  }

  await send(
    new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: track, isSigner: false, isWritable: true },
      ],
      data: discriminator("freeze_track"),
    }),
  );
  return { track, leaderboard };
}

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("\\\\wsl.localhost\\Ubuntu\\root\\.config\\solana\\id.json", "utf8"))),
);
const player = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(player.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");

console.log(`registering ${TRACK} (${circuit.sampleCount} samples) on ${URL_LOCAL}`);
const { track, leaderboard } = await registerCircuit(admin);

// Stands in for the relayer: signs as the player and pays as the sponsor.
const sponsor = admin;
let transactions = 0;
const send = async (build: (feePayer: string) => Promise<Instruction[]>) => {
  const instructions = await build(sponsor.publicKey.toBase58());
  const tx = new Transaction();
  for (const ix of instructions) {
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(ix.programAddress),
        keys: (ix.accounts ?? []).map((a: any) => ({
          pubkey: new PublicKey(a.address),
          // Roles: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer.
          isSigner: a.role === 2 || a.role === 3,
          isWritable: a.role === 1 || a.role === 3,
        })),
        data: Buffer.from(ix.data ?? []),
      }),
    );
  }
  tx.feePayer = sponsor.publicKey;
  transactions++;
  return sendAndConfirmTransaction(connection, tx, [sponsor, player], { commitment: "confirmed" });
};

console.log(`replaying Nova's ${rival.totalMs} ms run as ${player.publicKey.toBase58().slice(0, 8)}…`);
const before = await connection.getBalance(sponsor.publicKey);
const signature = await verifyRunOnChain(
  player.publicKey.toBase58(),
  TRACK,
  rival.trace,
  rival.steps,
  send,
  (p) => process.stdout.write(`\r  ${p.stage} ${p.steps}/${p.totalSteps} steps   `),
  { connection: kitRpc, track: { trackId: TRACK_ID, track: track.toBase58(), leaderboard: leaderboard.toBase58() } as TrackChain },
);
const after = await connection.getBalance(sponsor.publicKey);
console.log("");

// What the chain recorded.
const board = await connection.getAccountInfo(leaderboard);
const body = board!.data.subarray(8);
const entryCount = body.readUInt16LE(8);
const entry = body.subarray(24);
const totalMs = entry.readUInt32LE(64);
const steps = entry.readUInt32LE(68);
const runAccount = await connection.getAccountInfo(new PublicKey(await runPda(player.publicKey.toBase58() as any, TRACK_ID)));

console.log(`leaderboard: ${entryCount} entry, ${totalMs} ms over ${steps} steps`);
console.log(`transactions: ${transactions}, sponsor spent ${((before - after) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`run buffer closed: ${runAccount === null}`);
console.log(`signature: ${signature}`);

const ok = totalMs === rival.totalMs && steps === rival.steps && entryCount === 1 && runAccount === null;
console.log(ok ? "PASS: the chain derived the time the game shows" : "FAIL");
process.exit(ok ? 0 : 1);
