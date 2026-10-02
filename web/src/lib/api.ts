import { initData } from "./telegram";

export type Medal = "gold" | "silver" | "bronze" | null;

export type Session = {
  player: { telegramId: number; username: string | null; wallet: string | null; starterGranted: boolean };
  materials: Record<string, number>;
  bests: Record<string, number>;
  openGrant: { game_id: number; class_id: number; seq: string; expires_at: string } | null;
};

export type RunResult = {
  valid: boolean;
  reason: string | null;
  medal: Medal;
  reward: { material: string; amount: number };
  materials: Record<string, number>;
  best: number | null;
  personalBest: boolean;
  rank: number | null;
};

export type Grant = {
  gameId: number;
  classId: number;
  seq: string;
  expiresAt: number;
  signer: string;
  signature: string;
  price: number;
  backingBps: number;
};

export type LeaderGhost = {
  name: string;
  totalMs: number;
  splits: number[];
  ghost: { interval: number; samples: number[] };
};

export type LeaderboardEntry = { rank: number; name: string; frame: string | null; totalMs: number; at: string };

const GRANT_ENDPOINTS: Record<number, string> = { 1: "/api/grant", 2: "/api/glyph/grant" };

export async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify({ initData: initData(), ...body }) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }
  return json as T;
}

export const api = {
  session: (wallet?: string, frame?: string) => call<Session>("/api/session", { wallet, frame }),
  submitRun: (run: {
    trackId: string;
    totalMs: number;
    laps: number;
    respawns: number;
    splits: number[];
    ghost: { interval: number; samples: number[] };
  }) =>
    call<RunResult>("/api/run", run),
  /** Each game's own server signs grants for its items: Neon Racer here, Glyph Forge under /api/glyph. */
  grant: (wallet: string, gameId: number, classId: number) => {
    const path = GRANT_ENDPOINTS[gameId];
    if (!path) throw new Error(`no grant server for game ${gameId}`);
    return call<Grant>(path, { wallet, gameId, classId });
  },
  starter: (wallet: string) => call<{ signature: string | null; amount: number }>("/api/starter", { wallet }),
  leaderboard: (trackId: string) =>
    call<{ entries: LeaderboardEntry[] }>(`/api/leaderboard?track=${encodeURIComponent(trackId)}`),
  /** fresh skips the CDN cache, for right after the player changed the numbers. */
  stats: (fresh = false) => call<Stats>(fresh ? `/api/stats?t=${Date.now()}` : "/api/stats"),
  leader: (trackId: string) => call<{ leader: LeaderGhost | null }>(`/api/ghost?track=${encodeURIComponent(trackId)}`),
};

export type Stats = {
  totalBacked: number;
  games: { gameId: number; name: string; totalBacked: number; crafted: number; redeemed: number; vaultBalance: number }[];
  classes: { gameId: number; classId: number; backedSupply: number; backingPerUnit: number; crafted: number; redeemed: number }[];
  solvent: boolean;
};

export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--.--";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function formatUsdc(micro: number): string {
  return "$" + (micro / 1_000_000).toFixed(micro % 10_000 === 0 ? 2 : 4);
}
