import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { address, type Instruction } from "@solana/kit";

import catalogData from "../data/catalog.json";
import { api, type RunResult, type Session } from "../lib/api";
import { balancesOf, classConfig, compileSponsored, craftInstructions, redeemInstruction, type Quote } from "../lib/program";
import { SOLANA_CHAIN, SPONSOR_API } from "../config";
import type { Loadout, RaceFinished } from "../lib/unity";

export type Item = (typeof catalogData.games)[number]["items"][number] & { gameId: number };

export const catalog = catalogData;
export const allItems: Item[] = catalogData.games.flatMap((g) => g.items.map((i) => ({ ...i, gameId: g.gameId })));

const LOADOUT_KEY = "pv_loadout";
const DEFAULT_LOADOUT: Loadout = { chassis: "race", underglow: "", trail: "" };

type Balances = { usdc: number; items: Record<string, number> };

type GameState = {
  ready: boolean;
  wallet: string | null;
  session: Session | null;
  balances: Balances;
  loadout: Loadout;
  busy: string | null;
  error: string | null;
  owned: (item: Item) => number;
  refresh: () => Promise<void>;
  craft: (item: Item) => Promise<string>;
  redeem: (item: Item) => Promise<string>;
  route: (from: Item, to: Item) => Promise<string>;
  equip: (item: Item | null, type: "chassis" | "underglow" | "trail") => void;
  submitRun: (result: RaceFinished) => Promise<RunResult>;
  clearError: () => void;
};

const GameContext = createContext<GameState | null>(null);

export function useGame(): GameState {
  const state = useContext(GameContext);
  if (!state) throw new Error("useGame outside GameProvider");
  return state;
}

function readLoadout(): Loadout {
  try {
    return { ...DEFAULT_LOADOUT, ...JSON.parse(localStorage.getItem(LOADOUT_KEY) || "{}") };
  } catch {
    return DEFAULT_LOADOUT;
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  const [session, setSession] = useState<Session | null>(null);
  const [balances, setBalances] = useState<Balances>({ usdc: 0, items: {} });
  const [loadout, setLoadout] = useState<Loadout>(readLoadout);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const starterRequested = useRef(false);

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

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const [nextSession, nextBalances] = await Promise.all([api.session(wallet.address), balancesOf(wallet.address)]);
    setSession(nextSession);
    setBalances(nextBalances);

    // New players get a small USDC starter grant once, so their first craft costs nothing.
    if (!nextSession.player.starterGranted && !starterRequested.current) {
      starterRequested.current = true;
      api
        .starter(wallet.address)
        .then(() => balancesOf(wallet.address).then(setBalances))
        .catch(() => undefined);
    }
  }, [wallet]);

  useEffect(() => {
    if (authenticated && wallet) {
      refresh().catch((e) => setError(e.message));
    }
  }, [authenticated, wallet, refresh]);

  /** Signs with the embedded wallet (no Privy sheet) and has the relayer pay and submit. */
  const sponsor = useCallback(
    async (build: (feePayer: string) => Promise<Instruction[]>) => {
      if (!wallet) throw new Error("wallet not ready");
      const quote: Quote = await fetch(SPONSOR_API).then((r) => r.json());
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
        body: JSON.stringify({ transaction: btoa(binary) }),
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
        await refresh();
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const craft = useCallback(
    (item: Item) =>
      run(`Crafting ${item.name}`, async () => {
        const grant = await api.grant(wallet!.address, item.gameId, item.classId);
        return sponsor((feePayer) => craftInstructions(address(wallet!.address), address(feePayer), grant));
      }),
    [run, sponsor, wallet],
  );

  const redeem = useCallback(
    (item: Item) =>
      run(`Redeeming ${item.name}`, () =>
        sponsor(async () => [await redeemInstruction(address(wallet!.address), item.gameId, item.classId)]),
      ),
    [run, sponsor, wallet],
  );

  /** Burns an item in one game and crafts one in another, atomically, at par. */
  const route = useCallback(
    (from: Item, to: Item) =>
      run(`Moving ${from.name} to ${to.name}`, async () => {
        const grant = await api.grant(wallet!.address, to.gameId, to.classId);
        return sponsor(async (feePayer) => [
          await redeemInstruction(address(wallet!.address), from.gameId, from.classId),
          ...(await craftInstructions(address(wallet!.address), address(feePayer), grant)),
        ]);
      }),
    [run, sponsor, wallet],
  );

  const equip = useCallback((item: Item | null, type: "chassis" | "underglow" | "trail") => {
    setLoadout((current) => {
      const next = { ...current, [type]: item ? item.value : type === "chassis" ? "race" : "" };
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Never show cosmetics the player no longer owns (for example after redeeming).
  const effectiveLoadout = useMemo<Loadout>(() => {
    const ownsValue = (type: string, value: string) =>
      allItems.some((i) => i.type === type && i.value === value && owned(i) > 0);
    return {
      chassis: loadout.chassis === "race" || ownsValue("chassis", loadout.chassis) ? loadout.chassis : "race",
      underglow: loadout.underglow && ownsValue("underglow", loadout.underglow) ? loadout.underglow : "",
      trail: loadout.trail && ownsValue("trail", loadout.trail) ? loadout.trail : "",
    };
  }, [loadout, owned]);

  const submitRun = useCallback(
    async (result: RaceFinished) => {
      const response = await api.submitRun({
        trackId: result.trackId,
        totalMs: result.totalMs,
        laps: result.laps,
        respawns: result.respawns,
        splits: result.splits,
      });
      setSession((s) => (s ? { ...s, materials: response.materials } : s));
      return response;
    },
    [],
  );

  const value: GameState = {
    ready: privyReady && authenticated && !!wallet && !!session,
    wallet: wallet?.address ?? null,
    session,
    balances,
    loadout: effectiveLoadout,
    busy,
    error,
    owned,
    refresh,
    craft,
    redeem,
    route,
    equip,
    submitRun,
    clearError: () => setError(null),
  };
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
