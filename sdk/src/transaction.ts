import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

/** What a fee sponsor returns before a client builds a transaction for it to pay. */
export type SponsorQuote = { feePayer: string; blockhash: string; lastValidBlockHeight: number };

/**
 * Compiles instructions into an unsigned v0 transaction whose fee payer is the
 * sponsor. The player signs it, then the sponsor co-signs and submits.
 */
export function compileSponsored(instructions: Instruction[], quote: SponsorQuote): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(quote.feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: quote.blockhash as Blockhash, lastValidBlockHeight: BigInt(quote.lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}
