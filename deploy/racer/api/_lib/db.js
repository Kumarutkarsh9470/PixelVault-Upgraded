// Neon's HTTP driver: one round trip per query, no connection pool to manage
// inside short-lived serverless functions.
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

/** Bump when db/schema.sql changes; the next request applies it. */
const SCHEMA_VERSION = 3;

let client;
let schemaReady;

/**
 * The pooled Postgres connection string. The Vercel Neon integration names it
 * DATABASE_URL, or <PREFIX>_URL when connected with a custom prefix, so accept
 * any of those.
 */
export function databaseUrl(env = process.env) {
  for (const key of ["DATABASE_URL", "NEON_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    if (env[key] && env[key] !== "[SENSITIVE]") return env[key];
  }
  const pooled = Object.entries(env).find(
    ([key, value]) =>
      key.endsWith("_URL") && !/UNPOOLED|NON_POOLING|NO_SSL/.test(key) && /^postgres(ql)?:\/\//.test(value || ""),
  );
  return pooled ? pooled[1] : null;
}

export function sql() {
  if (!client) {
    const url = databaseUrl();
    if (!url) {
      throw new Error("No Postgres connection string is set (expected DATABASE_URL or <PREFIX>_URL)");
    }
    client = neon(url);
  }
  return client;
}

export function splitStatements(schema) {
  return schema
    .split(/;\s*$/m)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
}

/**
 * Applies db/schema.sql once per schema version. The schema is idempotent, so
 * concurrent cold starts running it together are harmless.
 */
export function ensureSchema() {
  schemaReady ??= (async () => {
    const db = sql();
    await db.query("create table if not exists schema_meta (id int primary key, version int not null)");
    const rows = await db.query("select version from schema_meta where id = 1");
    if (rows[0]?.version === SCHEMA_VERSION) return;

    const schema = fs.readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
    for (const statement of splitStatements(schema)) {
      await db.query(statement);
    }
    await db.query(
      "insert into schema_meta (id, version) values (1, $1) on conflict (id) do update set version = excluded.version",
      [SCHEMA_VERSION],
    );
  })().catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  return schemaReady;
}
