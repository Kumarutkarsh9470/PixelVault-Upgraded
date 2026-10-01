// Imports every API function module, so a broken import or missing file fails
// CI instead of a production request. Needs `node tools/sync-data.mjs` first.
// Usage: node tools/check-api.mjs
import fs from "node:fs";

const dir = new URL("../deploy/racer/api/", import.meta.url);
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  await import(new URL(file, dir).href);
  console.log("ok", `api/${file}`);
}
