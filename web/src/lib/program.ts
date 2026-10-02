// The racer's PixelVault deployment and chain access, built on @pixelvault/sdk.
import { createSolanaRpc } from "@solana/kit";
import { classDeployment, fetchBalances, type Deployment } from "@pixelvault/sdk";

import chainData from "../data/chain.json";

export const chain: Deployment = chainData;
export const rpc = createSolanaRpc(chain.rpc);

export const classConfig = (gameId: number, classId: number) => classDeployment(chain, gameId, classId);

/** Item balances (Token-2022) and USDC balance for a wallet. */
export const balancesOf = (owner: string) => fetchBalances(rpc, chain, owner);

/** Whether an item class has been created on-chain yet (the studio runs create_item_class). */
export function isDeployed(gameId: number, classId: number): boolean {
  try {
    classDeployment(chain, gameId, classId);
    return true;
  } catch {
    return false;
  }
}
