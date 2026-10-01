// The racer's PixelVault deployment and chain access, built on @pixelvault/sdk.
import { createSolanaRpc } from "@solana/kit";
import { classDeployment, fetchBalances, type Deployment } from "@pixelvault/sdk";

import chainData from "../data/chain.json";

export const chain: Deployment = chainData;
export const rpc = createSolanaRpc(chain.rpc);

export const classConfig = (gameId: number, classId: number) => classDeployment(chain, gameId, classId);

/** Item balances (Token-2022) and USDC balance for a wallet. */
export const balancesOf = (owner: string) => fetchBalances(rpc, chain, owner);
