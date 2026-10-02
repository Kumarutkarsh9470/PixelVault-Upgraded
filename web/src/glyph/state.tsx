// Glyph Forge's own state: session, runes, the equipped frame and aura, and
// the cosmetics the runner wears, including Neon Racer items in the wallet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { saveFrame, savedFrame } from "../lib/settings";
import { allItems, type Item } from "../state/catalog";
import { useWallet } from "../state/wallet";
import { glyphApi, type GlyphSession, type RunOutcome } from "./api";
import type { Cosmetics, FinishedEvent } from "./unity";

export const GLYPH_GAME_ID = 2;
const LOADOUT_KEY = "gf_loadout";
/** Neon Racer's loadout, on the same origin: the runner shows its trail and underglow. */
const RACER_LOADOUT_KEY = "pv_loadout";

type Loadout = { frame: string; aura: string };

type GlyphState = {
  ready: boolean;
  session: GlyphSession | null;
  error: string | null;
  loadout: Loadout;
  cosmetics: Cosmetics;
  equip: (item: Item | null, slot: "frame" | "aura") => void;
  submit: (runId: string, run: FinishedEvent) => Promise<RunOutcome>;
  refresh: () => Promise<void>;
};

const GlyphContext = createContext<GlyphState | null>(null);

export function useGlyph(): GlyphState {
  const state = useContext(GlyphContext);
  if (!state) throw new Error("useGlyph outside GlyphProvider");
  return state;
}

function read<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return fallback;
  }
}

export function GlyphProvider({ children }: { children: ReactNode }) {
  const { connected, wallet, owned, onChange, error: walletError } = useWallet();
  const [session, setSession] = useState<GlyphSession | null>(null);
  const [loadout, setLoadout] = useState<Loadout>(() => ({ ...read(LOADOUT_KEY, { frame: "", aura: "" }), frame: savedFrame() }));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (wallet) setSession(await glyphApi.session(wallet, savedFrame()));
  }, [wallet]);

  useEffect(() => {
    if (connected) refresh().catch((e) => setError(e.message));
  }, [connected, refresh]);

  // Crafting spends runes: refresh after every wallet action.
  useEffect(() => {
    onChange(refresh);
    return () => onChange(null);
  }, [onChange, refresh]);

  const equip = useCallback((item: Item | null, slot: "frame" | "aura") => {
    setLoadout((current) => {
      const next = { ...current, [slot]: item?.key ?? "" };
      try {
        localStorage.setItem(LOADOUT_KEY, JSON.stringify(next));
      } catch {
        // Still applies this session.
      }
      if (slot === "frame") saveFrame(next.frame);
      return next;
    });
  }, []);

  /** Only what the wallet actually holds is worn, whichever game it came from. */
  const cosmetics = useMemo<Cosmetics>(() => {
    const ownedItem = (match: (i: Item) => boolean) => allItems.find((i) => match(i) && owned(i) > 0);
    const racer = read(RACER_LOADOUT_KEY, { underglow: "", trail: "" });
    return {
      frame: ownedItem((i) => i.gameId === GLYPH_GAME_ID && i.key === loadout.frame)?.value ?? "",
      aura: ownedItem((i) => i.gameId === GLYPH_GAME_ID && i.key === loadout.aura)?.value ?? "",
      trail: ownedItem((i) => i.type === "trail" && i.value === racer.trail)?.value ?? "",
      underglow: ownedItem((i) => i.type === "underglow" && i.value === racer.underglow)?.value ?? "",
    };
  }, [loadout, owned]);

  const submit = useCallback(async (runId: string, run: FinishedEvent) => {
    const outcome = await glyphApi.submit(runId, run);
    setSession((s) => (s ? { ...s, materials: outcome.materials, player: { ...s.player, bestMm: outcome.bestMm } } : s));
    return outcome;
  }, []);

  const value: GlyphState = {
    ready: connected && !!session,
    session,
    error: error ?? walletError,
    loadout,
    cosmetics,
    equip,
    submit,
    refresh,
  };
  return <GlyphContext.Provider value={value}>{children}</GlyphContext.Provider>;
}
