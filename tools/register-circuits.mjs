// Puts every circuit on-chain, which is what makes its times verifiable: the
// program replays a run against this geometry, and once frozen it can never
// change, so every time on a leaderboard was set on the same track.
//
// Idempotent: a circuit that is already registered and frozen is skipped, and
// the addresses land in web/src/data/chain.json.
// Usage: node tools/register-circuits.mjs   (after tools/build-circuits.mjs)
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");
const ADMIN_PATH = process.env.ADMIN_KEY || "\\\\wsl.localhost\\Ubuntu\\root\\.config\\solana\\id.json";
/// Each sample is sixteen bytes and a transaction holds 1232.
const SAMPLES_PER_TX = 60;

const connection = new Connection(RPC, "confirmed");
const circuitsUrl = new URL("../web/src/data/circuits.json", import.meta.url);
const chainUrl = new URL("../web/src/data/chain.json", import.meta.url);
const circuits = JSON.parse(fs.readFileSync(circuitsUrl));
const chain = JSON.parse(fs.readFileSync(chainUrl));

const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_PATH, "utf8"))));
const discriminator = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const u64 = (value) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
};
const u32 = (value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
};
const i32 = (value) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
};
const u16 = (value) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
};

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];

/// Anchor's borsh layout for TrackArgs.
function trackArgs(id, circuit) {
  const name = Buffer.from(id, "utf8");
  return Buffer.concat([
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
    ...circuit.padSamples.map((sample, i) => Buffer.concat([u16(sample), i32(circuit.padLaterals[i])])),
  ]);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(instructions, description) {
  const tx = new Transaction().add(...instructions);
  // The public RPC rate-limits bursts; a short gap between the many sample
  // uploads keeps a registration inside its budget.
  await pause(Number(process.env.SEND_GAP_MS || 1500));
  const signature = await sendAndConfirmTransaction(connection, tx, [admin], {
    commitment: "confirmed",
  });
  console.log(`  ${description}: ${signature.slice(0, 16)}…`);
  return signature;
}

async function register(id, circuit, trackId) {
  // Tracks are scoped to the key that registers them, so no one can squat an id.
  const track = pda([Buffer.from("track"), admin.publicKey.toBuffer(), u64(trackId)]);
  const leaderboard = pda([Buffer.from("board"), admin.publicKey.toBuffer(), u64(trackId)]);

  const existing = await connection.getAccountInfo(track);
  // Byte 93 of the account body is `frozen` (authority 32, track_id 8, name 32,
  // spacing 4, wall_offset 4, start_heading 4, four u16s, laps 1); see sim::account::TrackConfig.
  const frozen = existing ? existing.data[8 + 93] === 1 : false;
  if (frozen) {
    console.log(`${id}: already registered and frozen`);
    return { trackId, track: track.toBase58(), leaderboard: leaderboard.toBase58() };
  }

  console.log(`${id}: registering ${circuit.sampleCount} samples as track ${trackId}`);
  if (!existing) {
    await send(
      [
        new TransactionInstruction({
          programId: PROGRAM,
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: track, isSigner: false, isWritable: true },
            { pubkey: leaderboard, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([discriminator("init_track"), u64(trackId), trackArgs(id, circuit)]),
        }),
      ],
      "created",
    );
  }

  for (let offset = 0; offset < circuit.sampleCount; offset += SAMPLES_PER_TX) {
    const end = Math.min(offset + SAMPLES_PER_TX, circuit.sampleCount);
    const data = Buffer.concat(circuit.samples.slice(offset * 4, end * 4).map(i32));
    await send(
      [
        new TransactionInstruction({
          programId: PROGRAM,
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: track, isSigner: false, isWritable: true },
          ],
          data: Buffer.concat([
            discriminator("write_track_samples"),
            u16(offset),
            u32(data.length),
            data,
          ]),
        }),
      ],
      `samples ${offset}-${end}`,
    );
  }

  await send(
    [
      new TransactionInstruction({
        programId: PROGRAM,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          { pubkey: track, isSigner: false, isWritable: true },
        ],
        data: discriminator("freeze_track"),
      }),
    ],
    "frozen",
  );
  return { trackId, track: track.toBase58(), leaderboard: leaderboard.toBase58() };
}

const balance = await connection.getBalance(admin.publicKey);
console.log(`admin ${admin.publicKey.toBase58()} holds ${(balance / 1e9).toFixed(3)} SOL`);

chain.tracks = chain.tracks || {};
let nextId = Math.max(0, ...Object.values(chain.tracks).map((t) => t.trackId)) + 1;
for (const [id, circuit] of Object.entries(circuits)) {
  const trackId = chain.tracks[id]?.trackId ?? nextId++;
  chain.tracks[id] = await register(id, circuit, trackId);
}

fs.writeFileSync(chainUrl, JSON.stringify(chain, null, 2) + "\n");
console.log("updated web/src/data/chain.json");
