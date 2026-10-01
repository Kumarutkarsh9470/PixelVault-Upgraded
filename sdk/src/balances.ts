import {
  address,
  type GetTokenAccountBalanceApi,
  type GetTokenAccountsByOwnerApi,
  type Rpc,
} from "@solana/kit";

import { associatedTokenAddress, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "./accounts.ts";
import { classDeployment, type Deployment } from "./deployment.ts";
import type { ItemRef } from "./instructions.ts";

export type Balances = {
  /** USDC in base units (6 decimals). */
  usdc: number;
  /** Item units held, keyed by item mint address. */
  items: Record<string, number>;
};

/** A wallet's USDC balance and every Token-2022 item it holds. */
export async function fetchBalances(
  rpc: Rpc<GetTokenAccountsByOwnerApi & GetTokenAccountBalanceApi>,
  deployment: Deployment,
  owner: string,
): Promise<Balances> {
  const ownerAddress = address(owner);
  const usdcAccount = await associatedTokenAddress(ownerAddress, address(deployment.usdcMint), TOKEN_PROGRAM);
  const [itemAccounts, usdc] = await Promise.all([
    rpc.getTokenAccountsByOwner(ownerAddress, { programId: TOKEN_2022_PROGRAM }, { encoding: "jsonParsed" }).send(),
    rpc
      .getTokenAccountBalance(usdcAccount)
      .send()
      .catch(() => null),
  ]);
  const items: Record<string, number> = {};
  for (const account of itemAccounts.value) {
    const info = (account.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string } } } })
      .parsed.info;
    items[info.mint] = Number(info.tokenAmount.amount);
  }
  return { usdc: usdc ? Number(usdc.value.amount) : 0, items };
}

/**
 * How many units of one item a wallet holds, in a single RPC call. Any game can
 * use this to honour another game's items: ownership lives on-chain, not in
 * either studio's database.
 */
export async function itemBalance(
  rpc: Rpc<GetTokenAccountBalanceApi>,
  deployment: Deployment,
  owner: string,
  item: ItemRef,
): Promise<number> {
  const mint = address(classDeployment(deployment, item.gameId, item.classId).mint);
  const account = await associatedTokenAddress(address(owner), mint, TOKEN_2022_PROGRAM);
  const balance = await rpc
    .getTokenAccountBalance(account)
    .send()
    .catch(() => null);
  return balance ? Number(balance.value.amount) : 0;
}
