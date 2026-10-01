// On-chain reads and grant signing for the game server, on @pixelvault/sdk.
import fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { address, createSolanaRpc } from "@solana/kit";

import { createGrantSigner, fetchNextGrantSeq, GRANT_TTL_SECONDS, signGrant } from "./sdk/index.js";

export { GRANT_TTL_SECONDS };

const deployment = JSON.parse(fs.readFileSync(new URL("../../data/chain.json", import.meta.url)));
const rpcUrl = () => process.env.RPC_URL || deployment.rpc;

let connection;
/** web3.js connection, for the starter faucet and stats. */
export function rpc() {
  connection ??= new Connection(rpcUrl(), "confirmed");
  return connection;
}

let kitRpc;
/** The player's next unused grant sequence number in a game, read from the chain. */
export function nextGrantSeq(gameId, wallet) {
  kitRpc ??= createSolanaRpc(rpcUrl());
  return fetchNextGrantSeq(kitRpc, deployment, gameId, address(wallet));
}

let signer;
async function grantSigner() {
  if (!signer) {
    const raw = process.env.GRANT_SIGNER_SECRET;
    if (!raw) {
      throw new Error("GRANT_SIGNER_SECRET is not set");
    }
    signer = await createGrantSigner(JSON.parse(raw));
  }
  return signer;
}

/** Signs a grant for one craft; resolves to the SDK's Grant shape. */
export async function issueGrant(gameId, classId, wallet, seq, expiresAt) {
  return signGrant(deployment, await grantSigner(), { gameId, classId, player: address(wallet), seq, expiresAt });
}
