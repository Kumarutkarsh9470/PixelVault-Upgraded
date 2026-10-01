/** Addresses of one PixelVault deployment: what `tools/setup-devnet.mjs` writes to chain.json. */
export type Deployment = {
  cluster: string;
  rpc: string;
  programId: string;
  usdcMint: string;
  protocol: string;
  protocolTreasury: string;
  games: Record<string, GameDeployment>;
};

export type GameDeployment = {
  game: string;
  vault: string;
  treasury: string;
  classes: Record<string, { itemClass: string; mint: string }>;
};

export function gameDeployment(deployment: Deployment, gameId: number): GameDeployment {
  const game = deployment.games[String(gameId)];
  if (!game) throw new Error(`game ${gameId} is not set up on ${deployment.cluster}`);
  return game;
}

export function classDeployment(deployment: Deployment, gameId: number, classId: number) {
  const item = gameDeployment(deployment, gameId).classes[String(classId)];
  if (!item) throw new Error(`item ${gameId}/${classId} is not set up on ${deployment.cluster}`);
  return item;
}
