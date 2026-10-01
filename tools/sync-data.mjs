// Copies what the Vercel deploy folder needs from the rest of the repository:
//   1. shared game data (tracks, catalogue, chain addresses) from the web app,
//      so the API functions read exactly what the client ships;
//   2. the built SDK (sdk/dist) into api/_lib/sdk, because Vercel deploys
//      deploy/racer on its own and cannot reach ../../sdk.
// Run after changing anything in web/src/data or sdk/src (build the SDK first).
import fs from "node:fs";
import path from "node:path";

const from = new URL("../web/src/data/", import.meta.url);
const to = new URL("../deploy/racer/data/", import.meta.url);
fs.mkdirSync(to, { recursive: true });

for (const file of fs.readdirSync(from)) {
  if (file.endsWith(".json")) {
    fs.copyFileSync(new URL(file, from), new URL(file, to));
    console.log("synced", path.join("deploy/racer/data", file));
  }
}

const sdkDist = new URL("../sdk/dist/", import.meta.url);
const sdkTarget = new URL("../deploy/racer/api/_lib/sdk/", import.meta.url);
if (!fs.existsSync(new URL("index.js", sdkDist))) {
  console.error("sdk/dist is missing: run `npm ci && npm run build` in sdk/ first");
  process.exit(1);
}
fs.rmSync(sdkTarget, { recursive: true, force: true });
fs.mkdirSync(sdkTarget, { recursive: true });
for (const file of fs.readdirSync(sdkDist)) {
  if (file.endsWith(".js")) fs.copyFileSync(new URL(file, sdkDist), new URL(file, sdkTarget));
}
console.log("synced", "deploy/racer/api/_lib/sdk");
