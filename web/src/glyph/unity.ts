// The Glyph Forge runner's Unity build and the messages it exchanges with the page
// (see glyph/game/Assets/Scripts/Bridge).
import { createUnityBridge } from "../lib/unity";

export const runner = createUnityBridge({ build: "/glyph/Build", productName: "Glyph Forge", eventPrefix: "glyph" });

/** Hex colours; empty for none. */
export type Cosmetics = { frame: string; aura: string; trail: string; underglow: string };

export type RunHud = { tick: number; distanceMm: number; speedMmPerSecond: number; ember: number; tide: number; storm: number };

export type FinishedEvent = {
  /** Flattened [tick, action] pairs. */
  inputs: number[];
  endTick: number;
  died: boolean;
  distanceMm: number;
  ember: number;
  tide: number;
  storm: number;
};

export type RuneEvent = { type: number; row: number };

export const RUNE_IDS: Record<number, string> = { 4: "ember-rune", 5: "tide-rune", 6: "storm-rune" };
