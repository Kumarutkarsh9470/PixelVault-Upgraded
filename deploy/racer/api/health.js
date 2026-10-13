// Operational health, for uptime monitors and for us: whether the database
// answers, how much SOL the fee sponsor and the funder have left, and whether
// the deployed program is the one this build expects. Never includes secrets.
//   GET /api/health  -> 200 when everything is fine, 503 with the failing checks otherwise
import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";

import { rpc } from "./_lib/chain.js";
import { databaseUrl, sql } from "./_lib/db.js";
import { route } from "./_lib/http.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));

/** Below this the relayer will start failing within hours at normal traffic. */
const SPONSOR_WARN_SOL = Number(process.env.SPONSOR_WARN_SOL || 0.5);
const FUNDER_WARN_SOL = Number(process.env.FUNDER_WARN_SOL || 0.1);

function publicKeyOf(envName) {
  const raw = process.env[envName];
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))).publicKey;
  } catch {
    return null;
  }
}

export default route(["GET"], async (_req, res) => {
  const connection = rpc();
  const checks = {};
  const started = Date.now();

  checks.database = databaseUrl()
    ? await sql()`select 1 as ok`.then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }))
    : { ok: false, error: "no database configured" };

  const [program, sponsor, funder, slot] = await Promise.all([
    connection.getAccountInfo(new PublicKey(chain.programId)).catch(() => null),
    (async () => {
      const key = publicKeyOf("SPONSOR_SECRET_KEY");
      if (!key) return { ok: false, error: "SPONSOR_SECRET_KEY is not set" };
      const sol = (await connection.getBalance(key)) / 1e9;
      return { ok: sol >= SPONSOR_WARN_SOL, address: key.toBase58(), sol, warnBelow: SPONSOR_WARN_SOL };
    })().catch((e) => ({ ok: false, error: e.message })),
    (async () => {
      const key = publicKeyOf("FUNDER_SECRET");
      if (!key) return { ok: chain.cluster !== "devnet", error: "FUNDER_SECRET is not set" };
      const sol = (await connection.getBalance(key)) / 1e9;
      return { ok: sol >= FUNDER_WARN_SOL, address: key.toBase58(), sol, warnBelow: FUNDER_WARN_SOL };
    })().catch((e) => ({ ok: false, error: e.message })),
    connection.getSlot().catch(() => null),
  ]);

  checks.rpc = { ok: slot !== null, slot, cluster: chain.cluster };
  checks.program = { ok: !!program?.executable, programId: chain.programId };
  checks.sponsor = sponsor;
  checks.funder = funder;
  checks.grantSigner = { ok: !!process.env.GRANT_SIGNER_SECRET, configured: !!process.env.GRANT_SIGNER_SECRET };
  checks.glyphGrantSigner = { ok: !!process.env.GLYPH_GRANT_SIGNER_SECRET, configured: !!process.env.GLYPH_GRANT_SIGNER_SECRET };

  const ok = Object.values(checks).every((c) => c.ok);
  res.setHeader("Cache-Control", "no-store");
  res.status(ok ? 200 : 503);
  return { ok, checks, latencyMs: Date.now() - started, at: new Date().toISOString() };
});
