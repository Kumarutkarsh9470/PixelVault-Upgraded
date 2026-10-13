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
import { CRAFT_DISCRIMINATOR, CRAFT_RENT_PAYER_INDEX, REDEEM_DISCRIMINATOR } from "./instructions.ts";
import type { SponsorQuote } from "./transaction.ts";

export type SponsoredKind = "craft" | "redeem" | "route" | "withdraw";

export type SponsorVerdict = { kind: SponsoredKind; reason?: undefined } | { kind?: undefined; reason: string };

export type SponsorRpc = Rpc<GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi>;

export type SponsorOptions = {
  deployment: Pick<Deployment, "programId" | "usdcMint">;
  /** The fee payer's 64-byte secret key (the JSON byte array `solana-keygen` writes). */
  feePayerSecretKey: Uint8Array | number[];
  rpc: SponsorRpc;
  /** Smallest USDC withdrawal to pay for, in base units. Default $0.10, so dust cannot burn fees. */
  minWithdraw?: bigint;
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
const startsWith = (data: ArrayLike<number>, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((b, i) => data[i] === b);
const allZero = (bytes: ArrayLike<number> | null | undefined) => !bytes || Array.from(bytes).every((b) => b === 0);

export async function createSponsor(options: SponsorOptions): Promise<Sponsor> {
  const keys = await createKeyPairFromBytes(Uint8Array.from(options.feePayerSecretKey));
  const feePayer = await getAddressFromPublicKey(keys.publicKey);
  const programId = address(options.deployment.programId);
  const usdcMint = address(options.deployment.usdcMint);
  const minWithdraw = options.minWithdraw ?? 100_000n;
  // Only these programs may appear. The Compute Budget program is deliberately
  // absent: it would let a client attach an arbitrary priority fee the sponsor pays.
  const sponsoredPrograms = new Set<string>([programId, MEMO_PROGRAM, ED25519_PROGRAM, TOKEN_PROGRAM]);
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

    const seen = { craft: 0, redeem: 0, withdraw: 0 };
    for (const ix of message.instructions) {
      const program = keysList[ix.programAddressIndex];
      const data: ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number } = ix.data ?? new Uint8Array();
      const accounts = ix.accountIndices ?? [];
      if (!sponsoredPrograms.has(program)) {
        return refuse(`program ${program} is not sponsored`);
      }
      const isCraft = program === programId && startsWith(data, CRAFT_DISCRIMINATOR);
      for (const [position, keyIndex] of accounts.entries()) {
        if (keyIndex === 0 && !(isCraft && position === CRAFT_RENT_PAYER_INDEX)) {
          return refuse("instructions may only use the sponsor as the rent payer of craft");
        }
      }
      if (program === programId) {
        if (isCraft) seen.craft++;
        else if (startsWith(data, REDEEM_DISCRIMINATOR)) seen.redeem++;
        else return refuse("only craft and redeem are sponsored");
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
