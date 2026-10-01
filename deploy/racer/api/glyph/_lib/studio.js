// Glyph Forge's studio backend: its game id, catalogue, players, runes and
// grant signing. Integrates PixelVault only through @pixelvault/sdk, with its
// own grant key (GLYPH_GRANT_SIGNER_SECRET), exactly as a third-party studio would.
import fs from "node:fs";
import { address, createSolanaRpc } from "@solana/kit";

import { createGrantSigner, fetchNextGrantSeq, itemBalance, signGrant } from "../../_lib/sdk/index.js";
import { sql } from "../../_lib/db.js";
import { HttpError } from "../../_lib/http.js";
import { EMBER, STORM, TIDE } from "./runner.js";

const load = (file) => JSON.parse(fs.readFileSync(new URL(`../../../data/${file}`, import.meta.url)));
const deployment = load("chain.json");
const catalog = load("catalog.json");

export const GAME_ID = 2;
export const game = catalog.games.find((g) => g.gameId === GAME_ID);

export const RUNE_MATERIAL = { [EMBER]: "ember-rune", [TIDE]: "tide-rune", [STORM]: "storm-rune" };
/** Runes a player can earn per rolling 24 hours. */
export const DAILY_RUNE_CAP = 60;

export function findItem(classId) {
  const item = game.items.find((i) => i.classId === classId);
  if (!item) throw new HttpError(400, `unknown Glyph Forge item ${classId}`);
  return item;
}

export async function upsertRunner(user, wallet) {
  const [player] = await sql()`
    insert into glyph_players (telegram_id, name, wallet)
    values (${user.id}, ${user.username ?? user.firstName}, ${wallet ?? null})
    on conflict (telegram_id) do update set
      name = excluded.name,
      wallet = coalesce(glyph_players.wallet, excluded.wallet),
      last_seen_at = now()
    returning *`;
  return player;
}

export async function materialsOf(telegramId) {
  const rows = await sql()`select material, amount from glyph_materials where telegram_id = ${telegramId}`;
  return Object.fromEntries(rows.map((r) => [r.material, r.amount]));
}

export async function addMaterials(telegramId, amounts) {
  for (const [material, amount] of Object.entries(amounts)) {
    if (amount <= 0) continue;
    await sql()`
      insert into glyph_materials (telegram_id, material, amount) values (${telegramId}, ${material}, ${amount})
      on conflict (telegram_id, material) do update set amount = glyph_materials.amount + excluded.amount`;
  }
}

let kitRpc;
const rpc = () => (kitRpc ??= createSolanaRpc(process.env.RPC_URL || deployment.rpc));

export function nextGrantSeq(wallet) {
  return fetchNextGrantSeq(rpc(), deployment, GAME_ID, address(wallet));
}

/** `key` if the wallet holds that frame on-chain, otherwise null. */
export async function verifiedFrame(wallet, key) {
  const item = game.items.find((i) => i.key === key && i.type === "frame");
  if (!wallet || !item) return null;
  try {
    return (await itemBalance(rpc(), deployment, wallet, { gameId: GAME_ID, classId: item.classId })) > 0 ? key : null;
  } catch {
    return null;
  }
}

let signer;
export async function issueGrant(classId, wallet, seq, expiresAt) {
  if (!signer) {
    const raw = process.env.GLYPH_GRANT_SIGNER_SECRET;
    if (!raw) throw new Error("GLYPH_GRANT_SIGNER_SECRET is not set");
    signer = await createGrantSigner(JSON.parse(raw));
  }
  return signGrant(deployment, signer, { gameId: GAME_ID, classId, player: address(wallet), seq, expiresAt });
}

/**
 * Settles issued grants against the chain: used once the player's on-chain
 * sequence has moved past them, refunded once expired unused. Each settlement
 * is one atomic statement, so concurrent calls cannot refund twice.
 */
export async function reconcileGrants(telegramId) {
  const open = await sql()`select * from glyph_grants where telegram_id = ${telegramId} and status = 'issued'`;
  const now = Math.floor(Date.now() / 1000);
  for (const grant of open) {
    if ((await nextGrantSeq(grant.wallet)) > BigInt(grant.seq)) {
      await sql()`update glyph_grants set status = 'used' where id = ${grant.id} and status = 'issued'`;
    } else if (Number(grant.expires_at) < now) {
      await sql()`
        with settled as (
          update glyph_grants set status = 'refunded'
          where id = ${grant.id} and status = 'issued'
          returning telegram_id, recipe
        )
        insert into glyph_materials (telegram_id, material, amount)
        select settled.telegram_id, r.key, r.value::int
        from settled, jsonb_each_text(settled.recipe) r
        on conflict (telegram_id, material) do update set amount = glyph_materials.amount + excluded.amount`;
    }
  }
}
