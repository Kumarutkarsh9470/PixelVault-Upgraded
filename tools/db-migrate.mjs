// Applies deploy/racer/db/schema.sql to the database in DATABASE_URL (or the
// value pulled into deploy/racer/.env.local by `vercel env pull`). The schema
// is idempotent, so this is safe to run repeatedly.
// Usage: node tools/db-migrate.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const { neon } = require("@neondatabase/serverless");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = new URL("../deploy/racer/.env.local", import.meta.url);
  if (!fs.existsSync(envFile)) return null;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL="?([^"]+)"?$/);
    if (match) return match[1];
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL not found: connect the Neon database to the Vercel project, then run `npx vercel env pull .env.local` in deploy/racer");
  process.exit(1);
}

const sql = neon(url);
const schema = fs.readFileSync(new URL("../deploy/racer/db/schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/--.*$/gm, "").trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
  console.log("ok:", statement.split("\n")[0].slice(0, 70));
}
const tables = await sql.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
console.log("tables:", tables.map((t) => t.table_name).join(", "));
