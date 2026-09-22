// Applies deploy/racer/db/schema.sql to the database in DATABASE_URL (or the
// value pulled into deploy/racer/.env.local by `vercel env pull`). The schema
// is idempotent, so this is safe to run repeatedly.
// Usage: node tools/db-migrate.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const { neon } = require("@neondatabase/serverless");

// Same lookup the API uses, over the process env plus the pulled .env.local.
const { databaseUrl } = await import("../deploy/racer/api/_lib/db.js");
const env = { ...process.env };
const envFile = new URL("../deploy/racer/.env.local", import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match && !env[match[1]]) env[match[1]] = match[2];
  }
}

const url = databaseUrl(env);
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
