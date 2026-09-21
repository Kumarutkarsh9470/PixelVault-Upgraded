/** Public client identifier; safe to ship. The App Secret never goes in the client. */
export const PRIVY_APP_ID = "cmubr24hp00820cidrt8wvv4v";

export const SOLANA_CHAIN = "solana:devnet" as const;
export const RPC_URL = "https://api.devnet.solana.com";
export const RPC_WS_URL = "wss://api.devnet.solana.com";

/** Relayer that co-signs as fee payer, so players never need SOL. */
export const SPONSOR_API = "/api/sponsor";
