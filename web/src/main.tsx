import { createRoot } from "react-dom/client";

import App from "./App";
import { demoMode } from "./lib/demo";
import { AppProviders } from "./providers";
import { DemoGameProvider, GameProvider } from "./state/game";
import { DemoWalletProvider } from "./state/wallet";
import "./styles.css";
import "./fx.css";

// Inside Telegram: Privy sign-in and the real wallet. Anywhere else the same
// screens run on a local demo wallet (the showcase), so the page is playable
// in any browser.
createRoot(document.getElementById("root")!).render(
  <AppProviders>
    {demoMode ? (
      <DemoWalletProvider>
        <DemoGameProvider>
          <App />
        </DemoGameProvider>
      </DemoWalletProvider>
    ) : (
      <GameProvider>
        <App />
      </GameProvider>
    )}
  </AppProviders>,
);
