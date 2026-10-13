// Glyph Forge's whole backend as one serverless function. Vercel's Hobby plan
// caps a deployment at twelve functions, and the two studios have thirteen
// endpoints between them, so this file catches /api/glyph/<op> and hands the
// request to the handler in _lib/routes/<op>.js. The URLs the game calls and
// the handlers themselves are unchanged.
import grant from "./_lib/routes/grant.js";
import leaderboard from "./_lib/routes/leaderboard.js";
import run from "./_lib/routes/run.js";
import session from "./_lib/routes/session.js";
import start from "./_lib/routes/start.js";

const ops = { grant, leaderboard, run, session, start };

export default async function handler(req, res) {
  const op = req.query?.op ?? new URL(req.url, "http://localhost").pathname.split("/").filter(Boolean).pop();
  const route = Object.hasOwn(ops, op) ? ops[op] : null;
  if (!route) {
    return res.status(404).json({ error: "no such function" });
  }
  return route(req, res);
}
