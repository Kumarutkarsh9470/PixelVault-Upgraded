import { createRoot } from "react-dom/client";

import { demoMode } from "../lib/demo";
import { AppProviders } from "../providers";
import { DemoWalletProvider } from "../state/wallet";
import "../styles.css";
import "../fx.css";
import GlyphApp from "./GlyphApp";
import { DemoGlyphProvider, GlyphProvider } from "./state";

createRoot(document.getElementById("root")!).render(
  <AppProviders>
    {demoMode ? (
      <DemoWalletProvider>
        <DemoGlyphProvider>
          <GlyphApp />
        </DemoGlyphProvider>
      </DemoWalletProvider>
    ) : (
      <GlyphProvider>
        <GlyphApp />
      </GlyphProvider>
    )}
  </AppProviders>,
);
