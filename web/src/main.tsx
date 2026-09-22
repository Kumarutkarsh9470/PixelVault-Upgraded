import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

import App from "./App";
import { PRIVY_APP_ID, RPC_URL, RPC_WS_URL } from "./config";
import { GameProvider } from "./state/game";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Inside a Telegram Mini App, Telegram login is seamless (no button press).
        loginMethods: ["telegram", "email"],
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
        },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(RPC_WS_URL),
            },
          },
        },
        appearance: { theme: "dark", walletChainType: "solana-only" },
      }}
    >
      <GameProvider>
        <App />
      </GameProvider>
    </PrivyProvider>
  </StrictMode>,
);
