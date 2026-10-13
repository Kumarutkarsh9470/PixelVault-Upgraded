import type { ProtocolDeployment } from "./studio.ts";

/** The PixelVault protocol on Solana devnet, with its mock USDC mint. Register your game against this. */
export const DEVNET: ProtocolDeployment = {
  cluster: "devnet",
  rpc: "https://api.devnet.solana.com",
  programId: "AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ",
  usdcMint: "6EYihbTfyfyrtTSeiUybwrAJfYCquW8TmET1Rw2tmvmF",
  protocol: "HD56Wj5pVeQ5pHjxGvVqq995GAvc62ee3MMDJ2fU36Gy",
  protocolTreasury: "6bwzz7mCgxfFX35TVQWgpSTxxTUng21bpjyGCSYNQN4g",
};

export const NETWORKS: Record<string, ProtocolDeployment> = { devnet: DEVNET };
