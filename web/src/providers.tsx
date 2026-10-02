import { StrictMode, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

import { PRIVY_APP_ID, RPC_URL, RPC_WS_URL } from "./config";
import { WalletProvider } from "./state/wallet";

/** Sign-in and the shared wallet, for every page of the Mini App. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
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
        <WalletProvider>{children}</WalletProvider>
      </PrivyProvider>
    </StrictMode>
  );
}
