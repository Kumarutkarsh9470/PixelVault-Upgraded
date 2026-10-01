// Glyph Forge: signs a grant for one craft of a Glyph Forge item, after
// reserving its runes. Runes are spent once the craft lands on-chain, or
// refunded if the grant expires unused (see reconcileGrants).
import { GRANT_TTL_SECONDS } from "../_lib/sdk/index.js";
import { sql } from "../_lib/db.js";
import { HttpError, readBody, route } from "../_lib/http.js";
import { verifyInitData } from "../_lib/telegram.js";
import { findItem, GAME_ID, issueGrant, nextGrantSeq, reconcileGrants, upsertRunner } from "./_lib/studio.js";

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  if (Number(body.gameId ?? GAME_ID) !== GAME_ID) throw new HttpError(400, "this server only grants Glyph Forge items");
  const classId = Number(body.classId);
  const item = findItem(classId);

  const player = await upsertRunner(user, body.wallet);
  if (!player.wallet || player.wallet !== body.wallet) throw new HttpError(400, "wallet does not match this player");

  await reconcileGrants(user.id);
  const [open] = await sql()`select * from glyph_grants where telegram_id = ${user.id} and status = 'issued'`;
  if (open) {
    if (open.class_id !== classId) throw new HttpError(409, "finish or wait out your pending craft first");
    return respond(classId, player.wallet, BigInt(open.seq), Number(open.expires_at), item);
  }

  const seq = await nextGrantSeq(player.wallet);
  const expiresAt = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  const recipe = JSON.stringify(item.recipe || {});
  // One statement: take every rune the recipe needs only if the player has
  // all of them, and record the grant only if every deduction happened.
  const [result] = await sql().transaction(
    (tx) => [
      tx`
        with need as (
          select key as material, value::int as amount from jsonb_each_text(${recipe}::jsonb)
        ),
        enough as (
          select count(*) as n from glyph_materials m join need using (material)
          where m.telegram_id = ${user.id} and m.amount >= need.amount
        ),
        spent as (
          update glyph_materials m set amount = m.amount - need.amount
          from need, enough
          where m.telegram_id = ${user.id} and m.material = need.material
            and enough.n = (select count(*) from need)
          returning m.material
        )
        insert into glyph_grants (telegram_id, wallet, class_id, seq, expires_at, recipe)
        select ${user.id}, ${player.wallet}, ${classId}, ${seq.toString()}, ${expiresAt}, ${recipe}::jsonb
        where (select count(*) from spent) = (select count(*) from need)
        returning id`,
    ],
    { isolationLevel: "Serializable" },
  );
  if (result.length === 0) throw new HttpError(400, "not enough runes for this recipe");
  return respond(classId, player.wallet, seq, expiresAt, item);
});

async function respond(classId, wallet, seq, expiresAt, item) {
  const grant = await issueGrant(classId, wallet, seq, expiresAt);
  return { ...grant, price: item.price, backingBps: item.backingBps };
}
