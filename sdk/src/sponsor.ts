// A fee-payer relayer any studio can run. The host decides who the caller is
// (a session cookie, Telegram launch data, a signed nonce); the sponsor
// decides whether the transaction is one it is willing to pay for, then
// co-signs and submits it. Players never need to hold SOL.
import {
  address,
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type Address,
  type GetLatestBlockhashApi,
  type GetSignatureStatusesApi,
  type Rpc,
  type SendTransactionApi,
} from "@solana/kit";

import { ED25519_PROGRAM, MEMO_PROGRAM, TOKEN_PROGRAM } from "./accounts.ts";
import type { Deployment } from "./deployment.ts";
import { CRAFT_DISCRIMINATOR, REDEEM_DISCRIMINATOR } from "./instructions.ts";
import type { SponsorQuote } from "./transaction.ts";

export type SponsoredKind = "craft" | "redeem" | "route" | "withdraw" | "verify";

export type SponsorVerdict = { kind: SponsoredKind; reason?: undefined } | { kind?: undefined; reason: string };

export type SponsorRpc = Rpc<GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi>;

export const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");

/** Anchor discriminators of the run-verification instructions: sha256("global:<name>")[0..8]. */
export const OPEN_RUN_DISCRIMINATOR = new Uint8Array([252, 181, 149, 94, 46, 20, 82, 14]);
export const WRITE_RUN_DISCRIMINATOR = new Uint8Array([138, 229, 27, 182, 26, 47, 106, 119]);
export const VERIFY_RUN_DISCRIMINATOR = new Uint8Array([22, 196, 183, 200, 183, 232, 150, 234]);
export const CLOSE_RUN_DISCRIMINATOR = new Uint8Array([31, 61, 130, 76, 74, 147, 171, 204]);

/**
 * What the sponsor pays for in PixelVault, and where its own key may appear.
 * The program decides what it does with that role; this only limits which
 * roles are on offer.
 *   craft      account 1: rent_payer for a newly minted item
 *   open_run   account 0: payer for the buffer a run is verified in
 *   close_run  account 2: where that buffer's rent goes back to
 */
const INSTRUCTIONS: { discriminator: Uint8Array; kind: "craft" | "redeem" | "verify"; sponsorPosition: number | null }[] = [
  { discriminator: CRAFT_DISCRIMINATOR, kind: "craft", sponsorPosition: 1 },
  { discriminator: REDEEM_DISCRIMINATOR, kind: "redeem", sponsorPosition: null },
  { discriminator: OPEN_RUN_DISCRIMINATOR, kind: "verify", sponsorPosition: 0 },
  { discriminator: WRITE_RUN_DISCRIMINATOR, kind: "verify", sponsorPosition: null },
  { discriminator: VERIFY_RUN_DISCRIMINATOR, kind: "verify", sponsorPosition: null },
  { discriminator: CLOSE_RUN_DISCRIMINATOR, kind: "verify", sponsorPosition: 2 },
];

export type SponsorOptions = {
  deployment: Pick<Deployment, "programId" | "usdcMint">;
  /** The fee payer's 64-byte secret key (the JSON byte array `solana-keygen` writes). */
  feePayerSecretKey: Uint8Array | number[];
  rpc: SponsorRpc;
  /** Smallest USDC withdrawal to pay for, in base units. Default $0.10, so dust cannot burn fees. */
  minWithdraw?: bigint;
  /** Highest compute-unit limit a client may request. Default 1.4M, what one transaction can use. */
  maxComputeUnits?: number;
  /**
   * Called before every submission with the player and what the transaction
   * does. Throw to refuse: this is where a host applies its rate limits.
   */
  beforeSubmit?: (player: Address, kind: SponsoredKind) => Promise<void> | void;
  /** Called after a successful submission, for example to record it for rate limiting. */
  afterSubmit?: (player: Address, kind: SponsoredKind, signature: string) => Promise<void> | void;
  /** How long to wait for confirmation. Default 45 s. */
  confirmTimeoutMs?: number;
};

export type Sponsor = {
  feePayer: Address;
  /** What a client needs before it builds a transaction with `compileSponsored`. */
  quote: () => Promise<SponsorQuote>;
  /** Whether the sponsor would pay for this transaction on behalf of `player`, and why not. */
  inspect: (transaction: Uint8Array, player: Address) => SponsorVerdict;
  /** Checks, co-signs, submits and confirms. Throws with the refusal reason when it will not pay. */
  submit: (transaction: Uint8Array, player: Address) => Promise<{ signature: string; kind: SponsoredKind }>;
};

const TRANSFER_CHECKED = 12;
const SET_COMPUTE_UNIT_LIMIT = 2;
const startsWith = (data: ArrayLike<number>, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((b, i) => data[i] === b);
const allZero = (bytes: ArrayLike<number> | null | undefined) => !bytes || Array.from(bytes).every((b) => b === 0);

export async function createSponsor(options: SponsorOptions): Promise<Sponsor> {
  const keys = await createKeyPairFromBytes(Uint8Array.from(options.feePayerSecretKey));
  const feePayer = await getAddressFromPublicKey(keys.publicKey);
  const programId = address(options.deployment.programId);
  const usdcMint = address(options.deployment.usdcMint);
  const minWithdraw = options.minWithdraw ?? 100_000n;
  const maxComputeUnits = options.maxComputeUnits ?? 1_400_000;
  // Only these programs may appear. The Compute Budget program is allowed only
  // to raise the unit limit: a priority fee would let a client decide what the
  // sponsor pays.
  const sponsoredPrograms = new Set<string>([programId, MEMO_PROGRAM, ED25519_PROGRAM, TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM]);
  const rpc = options.rpc;

  const inspect = (bytes: Uint8Array, player: Address): SponsorVerdict => {
    const refuse = (reason: string): SponsorVerdict => ({ reason });
    let transaction;
    let message;
    try {
      transaction = getTransactionDecoder().decode(bytes);
      message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    } catch {
      return refuse("transaction could not be decoded");
    }
    if (!("instructions" in message)) {
      return refuse("unsupported transaction format");
    }
    const keysList = message.staticAccounts;
    if ("addressTableLookups" in message && message.addressTableLookups && message.addressTableLookups.length > 0) {
      return refuse("address lookup tables are not sponsored");
    }
    if (keysList[0] !== feePayer) {
      return refuse("fee payer must be the sponsor");
    }
    if (message.header.numSignerAccounts !== 2 || keysList[1] !== player) {
      return refuse("the only signer besides the sponsor must be your wallet");
    }
    if (allZero(transaction.signatures[player])) {
      return refuse("transaction is missing your signature");
    }

    const seen = { craft: 0, redeem: 0, withdraw: 0, verify: 0 };
    for (const ix of message.instructions) {
      const program = keysList[ix.programAddressIndex];
      const data: ArrayLike<number> = ix.data ?? new Uint8Array();
      const accounts = ix.accountIndices ?? [];
      if (!sponsoredPrograms.has(program)) {
        return refuse(`program ${program} is not sponsored`);
      }
      if (program === COMPUTE_BUDGET_PROGRAM) {
        if (data.length < 1 || data[0] !== SET_COMPUTE_UNIT_LIMIT) return refuse("only a compute unit limit may be sponsored");
        if (data.length !== 5) return refuse("malformed compute unit limit");
        const units = new DataView(Uint8Array.from(data).buffer).getUint32(1, true);
        if (units > maxComputeUnits) return refuse(`compute unit limit ${units} is above the ceiling`);
        continue;
      }
      const pv = program === programId ? INSTRUCTIONS.find((i) => startsWith(data, i.discriminator)) : undefined;
      if (program === programId && !pv) {
        return refuse("only craft, redeem and run verification are sponsored");
      }
      for (const [position, keyIndex] of accounts.entries()) {
        if (keyIndex === 0 && position !== (pv?.sponsorPosition ?? null)) {
          return refuse("the sponsor may only pay rent and fees, never act as a player");
        }
      }
      if (pv) {
        seen[pv.kind]++;
      } else if (program === TOKEN_PROGRAM) {
        // TransferChecked: [source, mint, destination, authority], data = [12, amount u64, decimals u8].
        if (data.length !== 10 || data[0] !== TRANSFER_CHECKED || accounts.length !== 4) {
          return refuse("only USDC TransferChecked is sponsored");
        }
        if (keysList[accounts[1]] !== usdcMint) return refuse("only USDC transfers are sponsored");
        if (keysList[accounts[3]] !== player) return refuse("you can only withdraw your own USDC");
        const amount = new DataView(Uint8Array.from(data).buffer).getBigUint64(1, true);
        if (amount < minWithdraw) return refuse("withdrawal is under the minimum the sponsor pays for");
        seen.withdraw++;
      }
    }

    const kinds = (Object.entries(seen) as [keyof typeof seen, number][]).filter(([, n]) => n > 0).map(([kind]) => kind);
    if (kinds.length === 0) return refuse("nothing to sponsor");
    if (seen.withdraw > 0 && kinds.length > 1) return refuse("withdrawals must be sent on their own");
    if (seen.verify > 0 && (seen.craft > 0 || seen.redeem > 0)) return refuse("run verification must be sent on its own");
    if (seen.craft > 1 || seen.redeem > 1) return refuse("one craft and one redeem per transaction");
    return { kind: seen.craft && seen.redeem ? "route" : kinds[0] };
  };

  const quote = async (): Promise<SponsorQuote> => {
    const { value } = await rpc.getLatestBlockhash().send();
    return { feePayer, blockhash: value.blockhash, lastValidBlockHeight: Number(value.lastValidBlockHeight) };
  };

  const submit = async (bytes: Uint8Array, player: Address) => {
    const verdict = inspect(bytes, player);
    if (verdict.reason) throw new Error(verdict.reason);
    const kind = verdict.kind as SponsoredKind;
    await options.beforeSubmit?.(player, kind);
    const signed = await partiallySignTransaction([keys], getTransactionDecoder().decode(bytes));
    const wire = getBase64EncodedWireTransaction(signed);
    const signature = await rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    await options.afterSubmit?.(player, kind, signature);
    await waitForConfirmation(rpc, signature, options.confirmTimeoutMs ?? 45_000);
    return { signature: String(signature), kind };
  };

  return { feePayer, quote, inspect, submit };
}

/** Polls until the signature is confirmed, or throws on failure or timeout. */
export async function waitForConfirmation(rpc: Rpc<GetSignatureStatusesApi>, signature: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][number]]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("transaction was not confirmed in time");
}
