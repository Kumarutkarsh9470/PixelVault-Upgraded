// Imports every API function module (api/**/*.js outside _lib), so a broken
// import or missing file fails CI instead of a production request. Needs
// `node tools/sync-data.mjs` first.
// Usage: node tools/check-api.mjs
import fs from "node:fs";

const root = new URL("../deploy/racer/api/", import.meta.url);
for (const entry of fs.readdirSync(root, { recursive: true })) {
  const file = String(entry);
  if (!file.endsWith(".js") || file.split(/[\\/]/).some((part) => part.startsWith("_"))) continue;
  await import(new URL(file, root).href);
  console.log("ok", `api/${file}`);
}
