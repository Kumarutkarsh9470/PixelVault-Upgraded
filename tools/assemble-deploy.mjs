// Assembles deploy/racer for a Vercel release:
//   1. Unity's Build/ output (only the engine files; the app provides the page)
//   2. the web app (index.html + assets/)
//   3. shared data (tracks, catalogue, chain addresses) for the API functions
// Then deploy with: cd deploy/racer && npx vercel --prod
// Usage: node tools/assemble-deploy.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const deploy = new URL("deploy/racer/", root);
const unityBuild = new URL("game/Builds/WebGL/Build/", root);

if (!fs.existsSync(unityBuild)) {
  console.error("No Unity build found at game/Builds/WebGL/Build — run the Unity build first");
  process.exit(1);
}

fs.rmSync(new URL("Build/", deploy), { recursive: true, force: true });
fs.cpSync(unityBuild, new URL("Build/", deploy), { recursive: true });
console.log("copied Unity build");

fs.rmSync(new URL("assets/", deploy), { recursive: true, force: true });
execSync("npm run build", { cwd: new URL("web/", root), stdio: "inherit" });
console.log("built web app");

execSync("node tools/sync-data.mjs", { cwd: root, stdio: "inherit" });

const size = (dir) =>
  fs.readdirSync(dir, { recursive: true }).reduce((sum, f) => {
    const p = new URL(f, dir);
    return fs.statSync(p).isFile() ? sum + fs.statSync(p).size : sum;
  }, 0);
console.log(`ready: Build ${(size(new URL("Build/", deploy)) / 1e6).toFixed(2)} MB, assets ${(size(new URL("assets/", deploy)) / 1e6).toFixed(2)} MB`);
