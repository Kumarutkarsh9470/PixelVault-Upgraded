// Copies the shared game data (tracks, catalogue, chain addresses) from the
// web app into the Vercel deploy folder, so the API functions read exactly
// what the client ships. Run after changing anything in web/src/data.
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
