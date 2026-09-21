// Builds a sponsored transaction exactly the way the app does (@solana/kit,
// pinned SPL Memo, relayer as fee payer), signs it with a throwaway player key
// in place of the Privy wallet, and submits it to a relayer.
// Usage: node scripts/test-sponsored-tx.mjs [baseUrl]
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";

const base = process.argv[2] || "http://localhost:8091";
const quote = await fetch(`${base}/api/sponsor`).then((r) => r.json());
if (!quote.feePayer) {
  console.log("quote failed:", quote);
  process.exit(1);
}

const player = await generateKeyPairSigner();
const memo = getAddMemoInstruction(
  { memo: "PixelVault kit client test", signers: [player] },
  { programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") },
);

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayer(address(quote.feePayer), m),
  (m) =>
    setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: quote.blockhash, lastValidBlockHeight: BigInt(quote.lastValidBlockHeight) },
      m,
    ),
  (m) => appendTransactionMessageInstructions([memo], m),
);

const signed = await partiallySignTransaction([player.keyPair], compileTransaction(message));
const response = await fetch(`${base}/api/sponsor`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transaction: getBase64EncodedWireTransaction(signed) }),
});
const body = await response.json();
console.log(base, "->", response.status, body);
process.exit(response.status === 200 && body.signature ? 0 : 1);
