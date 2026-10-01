// For game servers: decide that a player earned a craft, then sign a grant for it.
// Keep the signer's secret key on the server; rotate it on-chain with `update_game`.
import {
  address,
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  signBytes,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";

import { PLAYER_STATE_NEXT_SEQ_OFFSET, playerStatePda } from "./accounts.ts";
import { gameDeployment, type Deployment } from "./deployment.ts";
import { grantMessage, toBase64, type Grant } from "./grant.ts";

/** How long a signed grant stays usable. The program enforces whatever expiry the grant carries. */
export const GRANT_TTL_SECONDS = 180;

export type GrantSigner = { address: Address; keys: CryptoKeyPair };

/** Loads a grant signer from a 64-byte Solana secret key (the JSON byte array `solana-keygen` writes). */
export async function createGrantSigner(secretKey: Uint8Array | number[]): Promise<GrantSigner> {
  const keys = await createKeyPairFromBytes(Uint8Array.from(secretKey));
  return { address: await getAddressFromPublicKey(keys.publicKey), keys };
}

/**
 * The next grant sequence number the program will accept from this player in
 * this game. Every successful craft increments it, which is what makes a grant
 * single-use; read it from the chain each time you issue one.
 */
export async function fetchNextGrantSeq(
  rpc: Rpc<GetAccountInfoApi>,
  deployment: Deployment,
  gameId: number,
  player: Address,
): Promise<bigint> {
  const game = address(gameDeployment(deployment, gameId).game);
  const pda = await playerStatePda(address(deployment.programId), game, player);
  const { value } = await rpc.getAccountInfo(pda, { encoding: "base64" }).send();
  if (!value) return 0n;
  const data = Uint8Array.from(atob(value.data[0]), (c) => c.charCodeAt(0));
  return new DataView(data.buffer).getBigUint64(PLAYER_STATE_NEXT_SEQ_OFFSET, true);
}

export type GrantRequest = {
  gameId: number;
  classId: number;
  player: Address;
  seq: bigint;
  /** Unix seconds. Defaults to now + GRANT_TTL_SECONDS. */
  expiresAt?: number;
};

/** Signs a grant authorising `player` to craft one unit of `classId`, consuming sequence number `seq`. */
export async function signGrant(deployment: Deployment, signer: GrantSigner, request: GrantRequest): Promise<Grant> {
  const expiresAt = request.expiresAt ?? Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  const message = await grantMessage({
    programId: address(deployment.programId),
    game: address(gameDeployment(deployment, request.gameId).game),
    classId: request.classId,
    player: request.player,
    seq: request.seq,
    expiresAt,
  });
  const signature = await signBytes(signer.keys.privateKey, message);
  return {
    gameId: request.gameId,
    classId: request.classId,
    seq: request.seq.toString(),
    expiresAt,
    signer: signer.address,
    signature: toBase64(new Uint8Array(signature)),
  };
}
