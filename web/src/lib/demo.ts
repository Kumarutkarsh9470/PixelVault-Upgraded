// Showcase mode. Outside Telegram there is no signed launch data, so the
// backend cannot identify a player and nothing on-chain can be sponsored.
// Instead of a sign-in wall, the page runs the whole experience on a local
// demo wallet: the race is real (the engine runs here), crafts and redeems
// move pretend USDC, and every screen is reachable. Inside Telegram this
// module is inert.
import { useSyncExternalStore } from "react";

import { inTelegram } from "./telegram";

export const demoMode = !inTelegram;

export type DemoState = {
  usdc: number;
  /** Items held, keyed by `${gameId}-${classId}`. */
  items: Record<string, number>;
  materials: Record<string, number>;
  bests: Record<string, number>;
  glyphBestMm: number;
};

const KEY = "pv_demo";

const initial: DemoState = {
  usdc: 2_000_000,
  items: {},
  materials: { "neon-shard": 3, "sun-glass": 2, "frost-core": 2, "ember-rune": 12, "tide-rune": 8, "storm-rune": 4 },
  bests: {},
  glyphBestMm: 0,
};

function load(): DemoState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return saved ? { ...initial, ...saved, materials: { ...initial.materials, ...saved.materials } } : initial;
  } catch {
    return initial;
  }
}

let current = load();
const listeners = new Set<() => void>();

export const demo = {
  get: () => current,
  set(patch: Partial<DemoState> | ((s: DemoState) => Partial<DemoState>)) {
    current = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Lost on reload; fine for a showcase.
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset() {
    demo.set(initial);
  },
};

export function useDemo(): DemoState {
  return useSyncExternalStore(demo.subscribe, demo.get);
}

/** A short pause so the showcase feels like a transaction landing. */
export const settle = (ms = 900) => new Promise<void>((r) => setTimeout(r, ms));
