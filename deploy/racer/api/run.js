// Accepts a finished race, checks it is plausible, and pays out materials.
import { sql } from "./_lib/db.js";
import { findTrack, materialFor, medalFor, rejectReason, rewardFor } from "./_lib/game.js";
import { readBody, route } from "./_lib/http.js";
import { addMaterial, materialsOf, upsertPlayer } from "./_lib/players.js";
import { verifyInitData } from "./_lib/telegram.js";

/** Materials a player can earn per track per day, so replays cannot farm without limit. */
const DAILY_REWARD_CAP = 12;

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  await upsertPlayer(user);

  const track = findTrack(body.trackId);
  const run = {
    totalMs: body.totalMs,
    laps: body.laps,
    respawns: Number(body.respawns) || 0,
    splits: body.splits,
  };
  const reason = rejectReason(track, run);
  const valid = reason === null;
  const medal = valid ? medalFor(track, run.totalMs) : null;
  const material = materialFor(track);

  let reward = rewardFor(medal);
  if (reward > 0) {
    const [{ earned }] = await sql()`
      select coalesce(sum(reward), 0)::int as earned from runs
      where telegram_id = ${user.id} and track_id = ${track.id} and created_at > now() - interval '1 day'`;
    reward = Math.max(0, Math.min(reward, DAILY_REWARD_CAP - earned));
  }

  const [{ id: runId }] = await sql()`
    insert into runs (telegram_id, track_id, total_ms, respawns, medal, valid, reject_reason, splits, reward)
    values (${user.id}, ${track.id}, ${run.totalMs}, ${run.respawns}, ${medal}, ${valid}, ${reason},
            ${Array.isArray(run.splits) ? run.splits : []}, ${reward})
    returning id`;
  await addMaterial(user.id, material, reward);

  let personalBest = false;
  let best = null;
  let rank = null;
  if (valid) {
    const improved = await sql()`
      insert into best_times (telegram_id, track_id, total_ms, run_id)
      values (${user.id}, ${track.id}, ${run.totalMs}, ${runId})
      on conflict (telegram_id, track_id) do update
        set total_ms = excluded.total_ms, run_id = excluded.run_id, achieved_at = now()
        where excluded.total_ms < best_times.total_ms
      returning total_ms`;
    personalBest = improved.length > 0;
    const [row] = await sql()`select total_ms from best_times where telegram_id = ${user.id} and track_id = ${track.id}`;
    best = row?.total_ms ?? null;
    if (best !== null) {
      const [{ ahead }] = await sql()`
        select count(*)::int as ahead from best_times where track_id = ${track.id} and total_ms < ${best}`;
      rank = ahead + 1;
    }
  }

  return {
    valid,
    reason,
    medal,
    reward: { material, amount: reward },
    materials: await materialsOf(user.id),
    best,
    personalBest,
    rank,
  };
});
