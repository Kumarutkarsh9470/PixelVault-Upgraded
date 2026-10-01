import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is the Mini App's root page. It builds into the Vercel deploy
// folder next to the Unity build (Build/) and the API functions (api/), so
// the output directory must not be emptied.
export default defineConfig({
  base: "/",
  plugins: [react()],
  // The SDK is linked from ../sdk with its own node_modules; bundle one copy of kit.
  resolve: { dedupe: ["@solana/kit"] },
  build: {
    outDir: "../deploy/racer",
    emptyOutDir: false,
    assetsDir: "assets",
  },
});
