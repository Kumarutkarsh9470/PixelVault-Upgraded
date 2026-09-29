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

/** Longest trace the chain will verify, as base64. */
const MAX_TRACE_BASE64 = 2048 * 4 / 3 + 8;

/**
 * A run's inputs, as the game recorded them. The chain is what decides whether
 * they are a valid run; this only checks the string is a plausible trace
 * before it goes in the database or out to another player.
 */
export function cleanTrace(trace) {
  if (typeof trace !== "string" || trace.length < 4 || trace.length > MAX_TRACE_BASE64) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trace)) return null;
  // Traces are (input, repeat) pairs, so they decode to an even byte count.
  const bytes = (trace.length / 4) * 3 - (trace.endsWith("==") ? 2 : trace.endsWith("=") ? 1 : 0);
  if (!Number.isInteger(bytes) || bytes % 2 !== 0) return null;
  return trace;
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
