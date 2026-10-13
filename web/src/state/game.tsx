// Neon Racer's own state: the player's session and materials, the equipped
// loadout, and run submission. Wallet actions live in WalletProvider.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type RunResult, type Session } from "../lib/api";
import { savedFrame } from "../lib/settings";
import type { Loadout, RaceFinished } from "../lib/unity";
import { allItems, catalog, type Item } from "./catalog";
import { useWallet } from "./wallet";
import tracksData from "../data/tracks.json";
import { demo, settle, useDemo } from "../lib/demo";

const LOADOUT_KEY = "pv_loadout";
const DEFAULT_LOADOUT: Loadout = { chassis: "race", underglow: "", trail: "" };

type GameState = {
  ready: boolean;
  session: Session | null;
  loadout: Loadout;
  error: string | null;
  refresh: () => Promise<void>;
  equip: (item: Item | null, type: "chassis" | "underglow" | "trail") => void;
  submitRun: (result: RaceFinished) => Promise<RunResult>;
};

export const GameContext = createContext<GameState | null>(null);

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
  const { connected, wallet, owned, refreshBalances, onChange, error: walletError } = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [loadout, setLoadout] = useState<Loadout>(readLoadout);
  const [error, setError] = useState<string | null>(null);
  const starterRequested = useRef(false);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const next = await api.session(wallet, savedFrame());
    setSession(next);

    // New players get a small USDC starter grant once, so their first craft costs nothing.
    if (!next.player.starterGranted && !starterRequested.current) {
      starterRequested.current = true;
      api
        .starter(wallet)
        .then(refreshBalances)
        .catch(() => undefined);
    }
  }, [wallet, refreshBalances]);

  useEffect(() => {
    if (connected) refresh().catch((e) => setError(e.message));
  }, [connected, refresh]);

  // Crafting spends materials: refresh the session after every wallet action.
  useEffect(() => {
    onChange(refresh);
    return () => onChange(null);
  }, [onChange, refresh]);

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

  const submitRun = useCallback(async (result: RaceFinished) => {
    const response = await api.submitRun({
      trackId: result.trackId,
      totalMs: result.totalMs,
      laps: result.laps,
      respawns: result.respawns,
      splits: result.splits,
      ghost: result.ghost,
    });
    setSession((s) =>
      s
        ? {
            ...s,
            materials: response.materials,
            bests: response.best != null ? { ...s.bests, [result.trackId]: response.best } : s.bests,
          }
        : s,
    );
    return response;
  }, []);

  const value: GameState = {
    ready: connected && !!session,
    session,
    loadout: effectiveLoadout,
    error: error ?? walletError,
    refresh,
    equip,
    submitRun,
  };
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

type MedalKind = "gold" | "silver" | "bronze";

/** The showcase session: medals are judged here, from the same thresholds the server uses. */
export function DemoGameProvider({ children }: { children: ReactNode }) {
  const { owned, onChange } = useWallet();
  const state = useDemo();
  const [loadout, setLoadout] = useState<Loadout>(readLoadout);

  // Nothing to refetch: the store is local, but keep the wallet's contract.
  useEffect(() => {
    onChange(async () => undefined);
    return () => onChange(null);
  }, [onChange]);

  const equip = useCallback((item: Item | null, type: "chassis" | "underglow" | "trail") => {
    setLoadout((current) => {
      const next = { ...current, [type]: item ? item.value : type === "chassis" ? "race" : "" };
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const effectiveLoadout = useMemo<Loadout>(() => {
    const ownsValue = (type: string, value: string) =>
      allItems.some((i) => i.type === type && i.value === value && owned(i) > 0);
    return {
      chassis: loadout.chassis === "race" || ownsValue("chassis", loadout.chassis) ? loadout.chassis : "race",
      underglow: loadout.underglow && ownsValue("underglow", loadout.underglow) ? loadout.underglow : "",
      trail: loadout.trail && ownsValue("trail", loadout.trail) ? loadout.trail : "",
    };
  }, [loadout, owned]);

  const submitRun = useCallback(async (result: RaceFinished): Promise<RunResult> => {
    await settle(700);
    const track = tracksData.tracks.find((t) => t.id === result.trackId);
    const material = (catalog.materials as { id: string; track?: string }[]).find((m) => m.track === result.trackId)?.id ?? "neon-shard";
    let medal: MedalKind | null = null;
    if (track) {
      if (result.totalMs <= track.medals.gold) medal = "gold";
      else if (result.totalMs <= track.medals.silver) medal = "silver";
      else if (result.totalMs <= track.medals.bronze) medal = "bronze";
    }
    const amount = medal ? (catalog.medalRewards as Record<MedalKind, number>)[medal] : 0;
    const s = demo.get();
    const previous = s.bests[result.trackId];
    const personalBest = previous == null || result.totalMs < previous;
    const materials = { ...s.materials, [material]: (s.materials[material] ?? 0) + amount };
    const bests = personalBest ? { ...s.bests, [result.trackId]: result.totalMs } : s.bests;
    demo.set({ materials, bests });
    return {
      valid: true,
      reason: null,
      medal,
      reward: { material, amount },
      materials,
      best: bests[result.trackId] ?? null,
      personalBest,
      rank: null,
    };
  }, []);

  const session: Session = {
    player: { telegramId: 0, username: "Guest", wallet: null, starterGranted: true },
    materials: state.materials,
    bests: state.bests,
    openGrant: null,
  };

  const value: GameState = {
    ready: true,
    session,
    loadout: effectiveLoadout,
    error: null,
    refresh: async () => undefined,
    equip,
    submitRun,
  };
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
