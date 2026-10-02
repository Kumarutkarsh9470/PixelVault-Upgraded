// Neon Racer's own state: the player's session and materials, the equipped
// loadout, and run submission. Wallet actions live in WalletProvider.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type RunResult, type Session } from "../lib/api";
import { savedFrame } from "../lib/settings";
import type { Loadout, RaceFinished } from "../lib/unity";
import { allItems, type Item } from "./catalog";
import { useWallet } from "./wallet";

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
