import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";

import { RPC_URL, SPONSOR_API } from "./config";

const rpc = createSolanaRpc(RPC_URL);

// The memo library defaults to a newer memo program; pin the long-established
// SPL Memo program, which is the one the relayer's allowlist accepts.
const SPL_MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

type Quote = { feePayer: string; blockhash: string; lastValidBlockHeight: number };

export async function fetchSolBalance(owner: string): Promise<number> {
  const { value } = await rpc.getBalance(address(owner)).send();
  return Number(value) / 1e9;
}

/**
 * Builds a transaction the player signs but the sponsor pays for:
 * the relayer is the fee payer, the player is only an instruction signer.
 * `sign` must return the transaction with the player's signature filled in.
 */
export async function submitSponsoredMemo(
  player: string,
  sign: (unsigned: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const quote: Quote = await fetch(SPONSOR_API).then(readJson);

  const memo = getAddMemoInstruction(
    {
      memo: `PixelVault sponsored tx ${new Date().toISOString()}`,
      signers: [createNoopSigner(address(player))],
    },
    { programAddress: SPL_MEMO_PROGRAM },
  );

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(quote.feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: quote.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(quote.lastValidBlockHeight),
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions([memo], m),
  );

  const unsigned = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  const signed = await sign(unsigned);

  const result: { signature: string } = await fetch(SPONSOR_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: toBase64(signed) }),
  }).then(readJson);
  return result.signature;
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
