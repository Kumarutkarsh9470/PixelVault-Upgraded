import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds into the Vercel deploy folder so the wallet page is served beside the
// Unity build, on the same domain the Telegram Mini App points at.
export default defineConfig({
  base: "/wallet/",
  plugins: [react()],
  build: {
    outDir: "../deploy/racer/wallet",
    emptyOutDir: true,
  },
});
