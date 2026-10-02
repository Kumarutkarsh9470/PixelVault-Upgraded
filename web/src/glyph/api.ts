// Glyph Forge's own backend (/api/glyph/*): a separate studio from Neon Racer.
import { call } from "../lib/api";
import type { FinishedEvent } from "./unity";

export type GlyphSession = {
  player: { telegramId: number; name: string | null; wallet: string | null; bestMm: number };
  materials: Record<string, number>;
  openGrant: { class_id: number; seq: string; expires_at: string } | null;
};

export type RunOutcome = {
  distanceMm: number;
  endTick: number;
  died: boolean;
  /** Runes the replay collected, by material id. */
  runes: Record<string, number>;
  /** What was paid out after the daily cap. */
  reward: Record<string, number>;
  capped: boolean;
  materials: Record<string, number>;
  bestMm: number;
  personalBest: boolean;
};

export type GlyphEntry = { rank: number; name: string; frame: string | null; distanceMm: number };

/** Unity sends inputs flattened; the server takes [tick, action] pairs. */
const pairs = (flat: number[]) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);

export const glyphApi = {
  session: (wallet: string, frame: string) => call<GlyphSession>("/api/glyph/session", { wallet, frame }),
  start: (wallet: string) => call<{ runId: string; seed: number }>("/api/glyph/start", { wallet }),
  submit: (runId: string, run: FinishedEvent) =>
    call<RunOutcome>("/api/glyph/run", { runId, inputs: pairs(run.inputs), endTick: run.endTick, died: run.died }),
  leaderboard: () => call<{ entries: GlyphEntry[] }>("/api/glyph/leaderboard"),
};

export const formatDistance = (mm: number) => `${Math.floor(mm / 1000).toLocaleString()} m`;
