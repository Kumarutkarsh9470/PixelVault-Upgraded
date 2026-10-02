// The protocol layer both games share: the embedded wallet, its balances, and
// the sponsored PixelVault actions (craft, redeem, move between games, withdraw).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { address, isAddress, type Instruction } from "@solana/kit";
import {
  compileSponsored,
  craftInstructions,
  redeemInstruction,
  resolveUsdcAccount,
  routeInstructions,
  usdcTransferInstruction,
  type SponsorQuote,
} from "@pixelvault/sdk";

import { SOLANA_CHAIN, SPONSOR_API } from "../config";
import { api, formatUsdc } from "../lib/api";
import { balancesOf, chain, classConfig, rpc } from "../lib/program";
import { initData } from "../lib/telegram";
import type { Item } from "./catalog";

type Balances = { usdc: number; items: Record<string, number> };

type WalletState = {
  /** Privy is ready and the player is signed in with a wallet. */
  connected: boolean;
  wallet: string | null;
  balances: Balances;
  busy: string | null;
  error: string | null;
  owned: (item: Item) => number;
  refreshBalances: () => Promise<void>;
  craft: (item: Item) => Promise<string>;
  redeem: (item: Item) => Promise<string>;
  route: (from: Item, to: Item) => Promise<string>;
  withdraw: (to: string, amount: number) => Promise<string>;
  /** Called after every successful action, e.g. so a game can refresh its materials. */
  onChange: (listener: (() => Promise<unknown>) | null) => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const state = useContext(WalletContext);
  if (!state) throw new Error("useWallet outside WalletProvider");
  return state;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  const [balances, setBalances] = useState<Balances>({ usdc: 0, items: {} });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listener = useRef<(() => Promise<unknown>) | null>(null);

  const owned = useCallback(
    (item: Item) => {
      try {
        return balances.items[classConfig(item.gameId, item.classId).mint] ?? 0;
      } catch {
        return 0;
      }
    },
    [balances],
  );

  const refreshBalances = useCallback(async () => {
    if (wallet) setBalances(await balancesOf(wallet.address));
  }, [wallet]);

  useEffect(() => {
    if (authenticated && wallet) refreshBalances().catch((e) => setError(e.message));
  }, [authenticated, wallet, refreshBalances]);

  /** Signs with the embedded wallet (no Privy sheet) and has the relayer pay and submit. */
  const sponsor = useCallback(
    async (build: (feePayer: string) => Promise<Instruction[]>) => {
      if (!wallet) throw new Error("wallet not ready");
      const quote: SponsorQuote = await fetch(SPONSOR_API).then((r) => r.json());
      const instructions = await build(quote.feePayer);
      const unsigned = compileSponsored(instructions, quote);
      const { signedTransaction } = await signTransaction({
        transaction: unsigned,
        wallet,
        chain: SOLANA_CHAIN,
        options: { uiOptions: { showWalletUIs: false } },
      });
      let binary = "";
      for (const b of signedTransaction) binary += String.fromCharCode(b);
      const response = await fetch(SPONSOR_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: initData(), transaction: btoa(binary) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "transaction failed");
      return body.signature as string;
    },
    [wallet, signTransaction],
  );

  const run = useCallback(
    async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
      setBusy(label);
      setError(null);
      try {
        const result = await task();
        await Promise.all([refreshBalances(), listener.current?.()]);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [refreshBalances],
  );

  const craft = useCallback(
    (item: Item) =>
      run(`Crafting ${item.name}`, async () => {
        const grant = await api.grant(wallet!.address, item.gameId, item.classId);
        return sponsor((feePayer) =>
          craftInstructions(chain, { player: address(wallet!.address), rentPayer: address(feePayer), grant }),
        );
      }),
    [run, sponsor, wallet],
  );

  const redeem = useCallback(
    (item: Item) =>
      run(`Redeeming ${item.name}`, () => sponsor(async () => [await redeemInstruction(chain, address(wallet!.address), item)])),
    [run, sponsor, wallet],
  );

  /** Burns an item in one game and crafts one in another, atomically, at par. */
  const route = useCallback(
    (from: Item, to: Item) =>
      run(`Moving ${from.name} to ${to.name}`, async () => {
        const grant = await api.grant(wallet!.address, to.gameId, to.classId);
        return sponsor((feePayer) =>
          routeInstructions(chain, { player: address(wallet!.address), rentPayer: address(feePayer), from, grant }),
        );
      }),
    [run, sponsor, wallet],
  );

  /** Sends USDC from the game wallet to any Solana wallet or USDC account. */
  const withdraw = useCallback(
    (to: string, amount: number) =>
      run(`Withdrawing ${formatUsdc(amount)}`, async () => {
        const target = to.trim();
        if (!isAddress(target)) throw new Error("that is not a Solana address");
        if (target === wallet!.address) throw new Error("that is this game wallet; enter the wallet you want to send to");
        const destination = await resolveUsdcAccount(rpc, chain, target);
        return sponsor(async () => [
          await usdcTransferInstruction(chain, { owner: address(wallet!.address), destination, amount: BigInt(amount) }),
        ]);
      }),
    [run, sponsor, wallet],
  );

  const onChange = useCallback((next: (() => Promise<unknown>) | null) => {
    listener.current = next;
  }, []);
  const clearError = useCallback(() => setError(null), []);

  const value: WalletState = {
    connected: ready && authenticated && !!wallet,
    wallet: wallet?.address ?? null,
    balances,
    busy,
    error,
    owned,
    refreshBalances,
    craft,
    redeem,
    route,
    withdraw,
    onChange,
    clearError,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
