// Public protocol numbers, read directly from the chain rather than from our
// database, so anyone can verify the solvency claim for themselves.
import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";

import { rpc } from "./_lib/chain.js";
import { catalog } from "./_lib/game.js";
import { route } from "./_lib/http.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));

// Account layouts (after the 8-byte Anchor discriminator); see programs/pixelvault/src/state.rs.
const PROTOCOL_TOTAL_BACKED = 8 + 32 * 3 + 2 + 8 + 8;
const GAME = { totalBacked: 112, crafted: 128, redeemed: 136 };
const CLASS = { backingPerUnit: 88, backedSupply: 106, crafted: 114, redeemed: 122 };

const u64 = (data, offset) => Number(data.readBigUInt64LE(offset));

export default route(["GET"], async (_req, res) => {
  const connection = rpc();
  const gameIds = Object.keys(chain.games);
  const classRefs = gameIds.flatMap((gameId) =>
    Object.entries(chain.games[gameId].classes).map(([classId, c]) => ({ gameId: Number(gameId), classId: Number(classId), address: c.itemClass })),
  );

  const [protocolAccount, gameAccounts, classAccounts, vaultBalances] = await Promise.all([
    connection.getAccountInfo(new PublicKey(chain.protocol)),
    connection.getMultipleAccountsInfo(gameIds.map((id) => new PublicKey(chain.games[id].game))),
    connection.getMultipleAccountsInfo(classRefs.map((c) => new PublicKey(c.address))),
    Promise.all(gameIds.map((id) => connection.getTokenAccountBalance(new PublicKey(chain.games[id].vault)).catch(() => null))),
  ]);

  const games = gameIds.map((id, i) => {
    const data = gameAccounts[i]?.data;
    const vaultBalance = vaultBalances[i] ? Number(vaultBalances[i].value.amount) : 0;
    return {
      gameId: Number(id),
      name: catalog.games.find((g) => g.gameId === Number(id))?.name ?? `Game ${id}`,
      totalBacked: data ? u64(data, GAME.totalBacked) : 0,
      crafted: data ? u64(data, GAME.crafted) : 0,
      redeemed: data ? u64(data, GAME.redeemed) : 0,
      vaultBalance,
    };
  });

  const classes = classRefs.map((c, i) => {
    const data = classAccounts[i]?.data;
    return {
      gameId: c.gameId,
      classId: c.classId,
      backedSupply: data ? u64(data, CLASS.backedSupply) : 0,
      backingPerUnit: data ? u64(data, CLASS.backingPerUnit) : 0,
      crafted: data ? u64(data, CLASS.crafted) : 0,
      redeemed: data ? u64(data, CLASS.redeemed) : 0,
    };
  });

  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
  return {
    totalBacked: protocolAccount ? u64(protocolAccount.data, PROTOCOL_TOTAL_BACKED) : 0,
    games,
    classes,
    // Every vault must hold at least what its game owes item holders.
    solvent: games.every((g) => g.vaultBalance >= g.totalBacked),
  };
});
