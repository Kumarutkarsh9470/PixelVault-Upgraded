// Who you race against: Nova (the calibrated rival every track ships with),
// the track leader's recorded line, or your own personal best.
import rivals from "../data/rivals.json";
import { api } from "./api";

export type OpponentKind = "nova" | "leader" | "best" | "none";

export type Opponent = {
  kind: Exclude<OpponentKind, "none">;
  name: string;
  totalMs: number;
  /** Race time at each checkpoint crossing, for live split deltas. */
  splits: number[];
  /** The opponent's inputs, base64. The game replays them to race you. */
  trace: string;
};

type RivalFile = Record<string, { name: string; totalMs: number; splits: number[]; trace: string }>;

const bestKey = (trackId: string) => `pv_best_${trackId}`;
const leaders = new Map<string, Promise<Opponent | null>>();

export function nova(trackId: string): Opponent | null {
  const r = (rivals as RivalFile)[trackId];
  return r ? { kind: "nova", name: r.name, totalMs: r.totalMs, splits: r.splits, trace: r.trace } : null;
}

export function personalBest(trackId: string): Opponent | null {
  try {
    const saved = JSON.parse(localStorage.getItem(bestKey(trackId)) || "null");
    if (typeof saved?.trace === "string" && saved.trace.length > 0) {
      return { kind: "best", name: "Your best", totalMs: saved.totalMs, splits: saved.splits ?? [], trace: saved.trace };
    }
  } catch {
    // Unreadable storage: no personal ghost.
  }
  return null;
}

export function savePersonalBest(trackId: string, run: { totalMs: number; splits: number[]; trace: string }) {
  try {
    localStorage.setItem(bestKey(trackId), JSON.stringify(run));
    localStorage.removeItem(`pv_ghost_${trackId}`);
  } catch {
    // Storage full or unavailable; the server still keeps the best.
  }
}

export function leader(trackId: string, refresh = false): Promise<Opponent | null> {
  if (refresh || !leaders.has(trackId)) {
    leaders.set(
      trackId,
      api
        .leader(trackId)
        .then(({ leader: l }) =>
          l ? { kind: "leader" as const, name: l.name, totalMs: l.totalMs, splits: l.splits, trace: l.trace } : null,
        )
        .catch(() => null),
    );
  }
  return leaders.get(trackId)!;
}
