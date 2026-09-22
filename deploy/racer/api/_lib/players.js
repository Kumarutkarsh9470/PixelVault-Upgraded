import { nextGrantSeq } from "./chain.js";
import { sql } from "./db.js";

export async function upsertPlayer(user, wallet) {
  const rows = await sql()`
    insert into players (telegram_id, username, first_name, wallet)
    values (${user.id}, ${user.username}, ${user.firstName}, ${wallet ?? null})
    on conflict (telegram_id) do update set
      username = excluded.username,
      first_name = excluded.first_name,
      wallet = coalesce(excluded.wallet, players.wallet),
      last_seen_at = now()
    returning *`;
  return rows[0];
}

export async function materialsOf(telegramId) {
  const rows = await sql()`select material, amount from materials where telegram_id = ${telegramId}`;
  return Object.fromEntries(rows.map((r) => [r.material, r.amount]));
}

export async function bestTimesOf(telegramId) {
  const rows = await sql()`select track_id, total_ms from best_times where telegram_id = ${telegramId}`;
  return Object.fromEntries(rows.map((r) => [r.track_id, r.total_ms]));
}

export async function addMaterial(telegramId, material, amount) {
  if (amount <= 0) {
    return;
  }
  await sql()`
    insert into materials (telegram_id, material, amount) values (${telegramId}, ${material}, ${amount})
    on conflict (telegram_id, material) do update set amount = materials.amount + excluded.amount`;
}

/**
 * Settles issued grants against the chain. A grant is used once the player's
 * on-chain sequence has moved past it; one that expired unused has its
 * reserved materials refunded. Each settlement is a single atomic statement,
 * so concurrent calls cannot refund twice.
 */
export async function reconcileGrants(telegramId) {
  const open = await sql()`select * from grants where telegram_id = ${telegramId} and status = 'issued'`;
  const now = Math.floor(Date.now() / 1000);
  for (const grant of open) {
    const next = await nextGrantSeq(grant.game_id, grant.wallet);
    if (next > BigInt(grant.seq)) {
      await sql()`update grants set status = 'used' where id = ${grant.id} and status = 'issued'`;
    } else if (Number(grant.expires_at) < now) {
      await sql()`
        with settled as (
          update grants set status = 'refunded'
          where id = ${grant.id} and status = 'issued'
          returning telegram_id, recipe
        )
        insert into materials (telegram_id, material, amount)
        select settled.telegram_id, r.key, r.value::int
        from settled, jsonb_each_text(settled.recipe) r
        on conflict (telegram_id, material) do update set amount = materials.amount + excluded.amount`;
    }
  }
}
