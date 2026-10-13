// Glyph Forge's own state: session, runes, the equipped frame and aura, and
// the cosmetics the runner wears, including Neon Racer items in the wallet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { saveFrame, savedFrame } from "../lib/settings";
import { allItems, type Item } from "../state/catalog";
import { useWallet } from "../state/wallet";
import { glyphApi, type GlyphSession, type RunOutcome } from "./api";
import type { Cosmetics, FinishedEvent } from "./unity";
import { demo, settle, useDemo } from "../lib/demo";

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

export const GlyphContext = createContext<GlyphState | null>(null);

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

const DAILY_RUNE_CAP = 60;

/** The showcase: runes are counted from the run the engine reports, with the same daily cap. */
export function DemoGlyphProvider({ children }: { children: ReactNode }) {
  const { owned, onChange } = useWallet();
  const state = useDemo();
  const [loadout, setLoadout] = useState<Loadout>(() => ({ ...read(LOADOUT_KEY, { frame: "", aura: "" }), frame: savedFrame() }));

  useEffect(() => {
    onChange(async () => undefined);
    return () => onChange(null);
  }, [onChange]);

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

  const submit = useCallback(async (_runId: string, run: FinishedEvent): Promise<RunOutcome> => {
    await settle(700);
    const s = demo.get();
    const runes: Record<string, number> = { "ember-rune": run.ember, "tide-rune": run.tide, "storm-rune": run.storm };
    const reward: Record<string, number> = {};
    for (const [id, n] of Object.entries(runes)) if (n > 0) reward[id] = Math.min(n, DAILY_RUNE_CAP);
    const materials = { ...s.materials };
    for (const [id, n] of Object.entries(reward)) materials[id] = (materials[id] ?? 0) + n;
    const personalBest = run.distanceMm > s.glyphBestMm;
    const bestMm = Math.max(s.glyphBestMm, run.distanceMm);
    demo.set({ materials, glyphBestMm: bestMm });
    return { distanceMm: run.distanceMm, endTick: run.endTick, died: run.died, runes, reward, capped: false, materials, bestMm, personalBest };
  }, []);

  const session: GlyphSession = {
    player: { telegramId: 0, name: "Guest", wallet: null, bestMm: state.glyphBestMm },
    materials: state.materials,
    openGrant: null,
  };

  const value: GlyphState = {
    ready: true,
    session,
    error: null,
    loadout,
    cosmetics,
    equip,
    submit,
    refresh: async () => undefined,
  };
  return <GlyphContext.Provider value={value}>{children}</GlyphContext.Provider>;
}
