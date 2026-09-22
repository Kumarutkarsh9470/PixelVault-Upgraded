import { databaseUrl, ensureSchema } from "./db.js";
import { AuthError } from "./telegram.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function readBody(req) {
  if (!req.body) {
    return {};
  }
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

/** Longest ghost we store: 10 samples a second for five minutes, 4 numbers each. */
const MAX_GHOST_SAMPLES = 4 * 10 * 300;

/**
 * A replay is display-only (it never affects rewards), but it is shown to other
 * players, so accept only a well-formed one whose length matches the run.
 */
export function cleanGhost(ghost, totalMs) {
  if (!ghost || typeof ghost !== "object") return null;
  const { interval, samples } = ghost;
  if (typeof interval !== "number" || interval < 0.05 || interval > 0.5) return null;
  if (!Array.isArray(samples) || samples.length < 8 || samples.length % 4 !== 0 || samples.length > MAX_GHOST_SAMPLES) return null;
  if (!samples.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100000)) return null;
  const durationMs = (samples.length / 4) * interval * 1000;
  if (Math.abs(durationMs - totalMs) > 1500) return null;
  return { interval, samples: samples.map((v) => Math.round(v * 100) / 100) };
}

/** Wraps a handler with method checks and consistent JSON errors. */
export function route(methods, handler) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      return res.status(405).json({ error: "method not allowed" });
    }
    try {
      if (databaseUrl()) {
        await ensureSchema();
      }
      const result = await handler(req, res);
      if (!res.headersSent) {
        res.status(200).json(result ?? {});
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof AuthError ? 401 : 500;
      if (status === 500) {
        console.error(e);
      }
      if (!res.headersSent) {
        res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
}
