// Sending a run to the chain to be replayed.
//
// The player uploads the inputs they pressed and the program drives them: no
// time is ever claimed, so there is nothing to forge. A race is more compute
// than one transaction holds, so verification is resumable and the run takes a
// handful of sponsored transactions.
import { AccountRole, address, getProgramDerivedAddress, getAddressEncoder, type Address, type Instruction } from "@solana/kit";

import chain from "../data/chain.json";
import { rpc } from "./program";

const PROGRAM = address(chain.programId);
const SYSTEM = address("11111111111111111111111111111111");
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111");

// Anchor discriminators: sha256("global:<name>")[..8].
const OPEN_RUN = new Uint8Array([252, 181, 149, 94, 46, 20, 82, 14]);
const WRITE_RUN = new Uint8Array([138, 229, 27, 182, 26, 47, 106, 119]);
const VERIFY_RUN = new Uint8Array([22, 196, 183, 200, 183, 232, 150, 234]);
const CLOSE_RUN = new Uint8Array([31, 61, 130, 76, 74, 147, 171, 204]);

/// Trace bytes per transaction, leaving room for signatures and accounts.
const TRACE_BYTES_PER_TX = 800;
/// Steps replayed per transaction. At roughly 1,700 compute units a step this
/// sits inside the 1.4M a transaction may ask for, with room to spare.
const STEPS_PER_TX = 700;
const COMPUTE_UNITS = 1_350_000;
/// Enough attempts for the longest run the chain will accept.
const MAX_VERIFY_TRANSACTIONS = 24;

export type TrackChain = { trackId: number; track: string; leaderboard: string };

export function trackChain(trackId: string): TrackChain | null {
  const tracks = (chain as { tracks?: Record<string, TrackChain> }).tracks;
  return tracks?.[trackId] ?? null;
}

export type VerifyProgress = {
  /** What the client is doing now, for the player to read. */
  stage: "uploading" | "replaying" | "recording" | "done";
  /** Simulation steps the chain has replayed so far, and the run's total. */
  steps: number;
  totalSteps: number;
};

const addressEncoder = getAddressEncoder();
const addressBytes = (value: Address) => new Uint8Array(addressEncoder.encode(value));

const u64 = (value: number | bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};
const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};
const u16 = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function pda(seeds: Uint8Array[]): Promise<Address> {
  const [found] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds });
  return found;
}

const seed = (text: string) => new TextEncoder().encode(text);

export async function runPda(player: Address, trackId: number): Promise<Address> {
  return pda([seed("run"), addressBytes(player), u64(trackId)]);
}

/** Raises the compute limit; a replay needs far more than the default. */
function computeBudget(units: number): Instruction {
  return { programAddress: COMPUTE_BUDGET, accounts: [], data: concat(new Uint8Array([2]), u32(units)) };
}

function openRun(player: Address, payer: Address, track: Address, run: Address, trackId: number, traceLength: number): Instruction {
  return {
    programAddress: PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: track, role: AccountRole.READONLY },
      { address: run, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: concat(OPEN_RUN, u64(trackId), u16(traceLength)),
  };
}

function writeRun(player: Address, run: Address, offset: number, chunk: Uint8Array): Instruction {
  return {
    programAddress: PROGRAM,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: run, role: AccountRole.WRITABLE },
    ],
    data: concat(WRITE_RUN, u16(offset), u32(chunk.length), chunk),
  };
}

function verifyRun(player: Address, track: Address, run: Address, leaderboard: Address, steps: number): Instruction {
  return {
    programAddress: PROGRAM,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: track, role: AccountRole.READONLY },
      { address: run, role: AccountRole.WRITABLE },
      { address: leaderboard, role: AccountRole.WRITABLE },
    ],
    data: concat(VERIFY_RUN, u32(steps)),
  };
}

function closeRun(player: Address, run: Address, rentRefund: Address): Instruction {
  return {
    programAddress: PROGRAM,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: run, role: AccountRole.WRITABLE },
      { address: rentRefund, role: AccountRole.WRITABLE },
    ],
    data: CLOSE_RUN,
  };
}

/// Where each field sits in a RunBuffer account, after the 8-byte
/// discriminator. See sim::account::RunBuffer.
const STEPS_OFFSET = 8 + 108;
const CURSOR_OFFSET = 8 + 118;
const FINISHED_OFFSET = 8 + 122;

type BufferState = { steps: number; cursor: number; finished: boolean } | null;

async function readRunBuffer(run: Address, connection: RpcClient): Promise<BufferState> {
  const account = await connection.getAccountInfo(run, { encoding: "base64" }).send();
  const encoded = account.value?.data?.[0];
  if (!encoded) {
    return null;
  }
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    steps: view.getUint32(STEPS_OFFSET, true),
    cursor: view.getUint16(CURSOR_OFFSET, true),
    finished: bytes[FINISHED_OFFSET] === 1,
  };
}

export type SendSponsored = (build: (feePayer: string) => Promise<Instruction[]>) => Promise<string>;

type RpcClient = typeof rpc;

/** Overrides for testing against a validator other than the configured one. */
export type VerifyOptions = { track?: TrackChain; connection?: RpcClient };

/**
 * Has the chain replay a run, and returns the signature of the transaction
 * that finished it: proof the program derived the time itself.
 */
export async function verifyRunOnChain(
  player: string,
  trackId: string,
  trace: string,
  totalSteps: number,
  send: SendSponsored,
  onProgress?: (progress: VerifyProgress) => void,
  options: VerifyOptions = {},
): Promise<string> {
  const connection = options.connection ?? rpc;
  const chainTrack = options.track ?? trackChain(trackId);
  if (!chainTrack) {
    throw new Error(`${trackId} is not registered on-chain`);
  }
  const playerAddress = address(player);
  const track = address(chainTrack.track);
  const leaderboard = address(chainTrack.leaderboard);
  const run = await runPda(playerAddress, chainTrack.trackId);
  const bytes = Uint8Array.from(atob(trace), (c) => c.charCodeAt(0));

  const report = (stage: VerifyProgress["stage"], steps: number) =>
    onProgress?.({ stage, steps, totalSteps });

  report("uploading", 0);
  // The first transaction reserves the buffer and carries as much of the trace
  // as fits beside it.
  const firstChunk = bytes.subarray(0, Math.min(TRACE_BYTES_PER_TX - 120, bytes.length));
  await send(async (feePayer) => [
    openRun(playerAddress, address(feePayer), track, run, chainTrack.trackId, bytes.length),
    writeRun(playerAddress, run, 0, firstChunk),
  ]);

  for (let offset = firstChunk.length; offset < bytes.length; offset += TRACE_BYTES_PER_TX) {
    const chunk = bytes.subarray(offset, Math.min(offset + TRACE_BYTES_PER_TX, bytes.length));
    await send(async () => [writeRun(playerAddress, run, offset, chunk)]);
  }

  report("replaying", 0);
  let signature = "";
  for (let attempt = 0; attempt < MAX_VERIFY_TRANSACTIONS; attempt++) {
    signature = await send(async () => [
      computeBudget(COMPUTE_UNITS),
      verifyRun(playerAddress, track, run, leaderboard, STEPS_PER_TX),
    ]);
    const state = await readRunBuffer(run, connection);
    report("replaying", state?.steps ?? 0);
    if (state?.finished) {
      break;
    }
    if (!state) {
      throw new Error("the run buffer disappeared mid-verification");
    }
    if (attempt === MAX_VERIFY_TRANSACTIONS - 1) {
      throw new Error("the chain did not finish replaying this run");
    }
  }

  report("recording", totalSteps);
  // Give the buffer's rent back to whoever paid it, so verifying a run costs
  // the sponsor only the fees.
  await send(async (feePayer) => [closeRun(playerAddress, run, address(feePayer))]).catch(() => "");

  report("done", totalSteps);
  return signature;
}
