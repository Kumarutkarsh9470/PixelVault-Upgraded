/** Must match MIN_BACKING_BPS / MAX_BACKING_BPS / MAX_PROTOCOL_FEE_BPS in the program's constants.rs. */
export const MIN_BACKING_BPS = 5_000;
export const MAX_BACKING_BPS = 9_500;
export const MAX_PROTOCOL_FEE_BPS = 2_500;

/** `amount * bps / 10_000`, rounded down, as the program's `apply_bps` does. */
const applyBps = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10_000n;

export type PriceSplit = {
  /** Locked in the game's vault; what redeeming one unit pays back. */
  backing: bigint;
  protocolFee: bigint;
  studioCut: bigint;
};

/** Where one craft's USDC goes, exactly as the program splits it. Amounts in USDC base units. */
export function splitPrice(price: bigint | number, backingBps: number, protocolFeeBps: number): PriceSplit {
  const backing = applyBps(BigInt(price), backingBps);
  const margin = BigInt(price) - backing;
  const protocolFee = applyBps(margin, protocolFeeBps);
  return { backing, protocolFee, studioCut: margin - protocolFee };
}

/** What redeeming one unit returns. */
export const refundOf = (price: bigint | number, backingBps: number) => applyBps(BigInt(price), backingBps);
