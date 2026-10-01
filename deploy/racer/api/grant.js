// Issues a signed material grant authorising one craft. Materials are
// reserved atomically; they are spent once the craft lands on-chain, or
// refunded if the grant expires unused (see reconcileGrants).
import { GRANT_TTL_SECONDS, issueGrant, nextGrantSeq } from "./_lib/chain.js";
import { sql } from "./_lib/db.js";
import { findItem } from "./_lib/game.js";
import { HttpError, readBody, route } from "./_lib/http.js";
import { reconcileGrants, upsertPlayer } from "./_lib/players.js";
import { verifyInitData } from "./_lib/telegram.js";

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  const gameId = Number(body.gameId);
  const classId = Number(body.classId);
  const { item } = findItem(gameId, classId);

  const player = await upsertPlayer(user, body.wallet);
  if (!player.wallet || player.wallet !== body.wallet) {
    throw new HttpError(400, "wallet does not match this player");
  }

  await reconcileGrants(user.id);
  const [open] = await sql()`select * from grants where telegram_id = ${user.id} and status = 'issued'`;
  if (open) {
    if (open.game_id !== gameId || open.class_id !== classId) {
      throw new HttpError(409, "finish or wait out your pending craft first");
    }
    // Same craft requested again (for example after a dropped connection): re-sign it.
    return respond(open.game_id, open.class_id, player.wallet, BigInt(open.seq), Number(open.expires_at), item);
  }

  const seq = await nextGrantSeq(gameId, player.wallet);
  const expiresAt = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  const recipe = JSON.stringify(item.recipe || {});

  // One statement: take every required material only if the player has all
  // of them, and record the grant only if every deduction happened.
  // Serializable isolation stops two concurrent grants spending the same materials.
  const [result] = await sql().transaction(
    (tx) => [
      tx`
        with need as (
          select key as material, value::int as amount from jsonb_each_text(${recipe}::jsonb)
        ),
        enough as (
          select count(*) as n from materials m join need using (material)
          where m.telegram_id = ${user.id} and m.amount >= need.amount
        ),
        spent as (
          update materials m set amount = m.amount - need.amount
          from need, enough
          where m.telegram_id = ${user.id} and m.material = need.material
            and enough.n = (select count(*) from need)
          returning m.material
        )
        insert into grants (telegram_id, wallet, game_id, class_id, seq, expires_at, recipe)
        select ${user.id}, ${player.wallet}, ${gameId}, ${classId}, ${seq.toString()}, ${expiresAt}, ${recipe}::jsonb
        where (select count(*) from spent) = (select count(*) from need)
        returning id`,
    ],
    { isolationLevel: "Serializable" },
  );
  if (result.length === 0) {
    throw new HttpError(400, "not enough materials for this recipe");
  }
  return respond(gameId, classId, player.wallet, seq, expiresAt, item);
});

async function respond(gameId, classId, wallet, seq, expiresAt, item) {
  const grant = await issueGrant(gameId, classId, wallet, seq, expiresAt);
  return { ...grant, price: item.price, backingBps: item.backingBps };
}
