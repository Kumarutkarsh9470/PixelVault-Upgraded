// Accepts a finished race and pays out materials for it.
//
// The time is not taken on trust. The player has the Solana program replay
// their inputs first, and this reads that transaction back off the chain: the
// medal, and any materials, come from the time the program derived. A run that
// has not been verified is still recorded, but earns nothing.
import { sql } from "./_lib/db.js";
import { findTrack, materialFor, medalFor, rejectReason, rewardFor } from "./_lib/game.js";
import { cleanTrace, readBody, route } from "./_lib/http.js";
import { addMaterial, materialsOf, upsertPlayer } from "./_lib/players.js";
import { verifyInitData } from "./_lib/telegram.js";
import { readVerifiedRun } from "./_lib/verified.js";

/** Materials a player can earn per track per day, so replays cannot farm without limit. */
const DAILY_REWARD_CAP = 12;

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  await upsertPlayer(user);

  const track = findTrack(body.trackId);
  const trace = cleanTrace(body.trace);
  const run = {
    totalMs: body.totalMs,
    laps: body.laps,
    respawns: 0,
    splits: body.splits,
  };

  // What the chain says, if the player had it replay the run.
  let verified = null;
  let verifyError = null;
  if (typeof body.signature === "string" && trace) {
    const [player] = await sql()`select wallet from players where telegram_id = ${user.id}`;
    try {
      verified = await readVerifiedRun({
        signature: body.signature,
        wallet: player?.wallet,
        trackId: track.id,
        trace,
      });
    } catch (e) {
      verifyError = e instanceof Error ? e.message : String(e);
    }
  }

  // Without a verified run this is the old sanity check, which earns nothing.
  const reason = verified ? null : (verifyError ?? rejectReason(track, run) ?? "run was not verified on-chain");
  const valid = verified !== null;
  const totalMs = verified ? verified.totalMs : run.totalMs;
  const medal = valid ? medalFor(track, totalMs) : null;
  const material = materialFor(track);
  const steps = verified ? verified.steps : Number.isInteger(body.steps) ? body.steps : null;

  let reward = rewardFor(medal);
  if (reward > 0) {
    const [{ earned }] = await sql()`
      select coalesce(sum(reward), 0)::int as earned from runs
      where telegram_id = ${user.id} and track_id = ${track.id} and created_at > now() - interval '1 day'`;
    reward = Math.max(0, Math.min(reward, DAILY_REWARD_CAP - earned));
  }

  // The signature is unique, so a verified run can only ever be paid once.
  const inserted = await sql()`
    insert into runs (telegram_id, track_id, total_ms, respawns, medal, valid, reject_reason, splits, reward,
                      trace, steps, signature)
    values (${user.id}, ${track.id}, ${totalMs}, 0, ${medal}, ${valid}, ${reason},
            ${Array.isArray(run.splits) ? run.splits : []}, ${reward}, ${trace}, ${steps},
            ${verified ? body.signature : null})
    on conflict (signature) do nothing
    returning id`;
  if (inserted.length === 0) {
    throw new Error("this run has already been recorded");
  }
  const runId = inserted[0].id;
  await addMaterial(user.id, material, reward);

  let personalBest = false;
  let best = null;
  let rank = null;
  if (valid) {
    const improved = await sql()`
      insert into best_times (telegram_id, track_id, total_ms, run_id, trace, steps, splits)
      values (${user.id}, ${track.id}, ${totalMs}, ${runId}, ${trace}, ${steps}, ${run.splits})
      on conflict (telegram_id, track_id) do update
        set total_ms = excluded.total_ms, run_id = excluded.run_id, achieved_at = now(),
            trace = excluded.trace, steps = excluded.steps, splits = excluded.splits
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
    verified: verified !== null,
    reason,
    // The time the program derived, which is what the medal was judged on.
    totalMs,
    signature: verified ? body.signature : null,
    medal,
    reward: { material, amount: reward },
    materials: await materialsOf(user.id),
    best,
    personalBest,
    rank,
  };
});
