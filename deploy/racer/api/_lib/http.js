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

/** Wraps a handler with method checks and consistent JSON errors. */
export function route(methods, handler) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      return res.status(405).json({ error: "method not allowed" });
    }
    try {
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
