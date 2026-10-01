// Glyph Forge: accepts a finished run's inputs, replays them on the run's seed,
// and pays out the runes the replay actually collected, up to the daily cap.
import { sql } from "../_lib/db.js";
import { HttpError, readBody, route } from "../_lib/http.js";
import { verifyInitData } from "../_lib/telegram.js";
import { judgeRun } from "./_lib/judge.js";
import { addMaterials, DAILY_RUNE_CAP, materialsOf, RUNE_MATERIAL } from "./_lib/studio.js";

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  const runId = Number(body.runId);
  if (!Number.isSafeInteger(runId)) throw new HttpError(400, "unknown run");

  const [run] = await sql()`select * from glyph_runs where id = ${runId} and telegram_id = ${user.id}`;
  if (!run) throw new HttpError(404, "unknown run");
  if (run.finished_at) throw new HttpError(409, "this run was already submitted");

  const [{ earned }] = await sql()`
    select coalesce(sum(reward), 0)::int as earned from glyph_runs
    where telegram_id = ${user.id} and finished_at > now() - interval '1 day'`;
  const verdict = judgeRun(
    { seed: Number(run.seed), startedAtMs: new Date(run.started_at).getTime() },
    { inputs: body.inputs, endTick: body.endTick, died: body.died },
    { nowMs: Date.now(), earnedToday: earned, dailyCap: DAILY_RUNE_CAP, runeMaterial: RUNE_MATERIAL },
  );

  if (!verdict.valid) {
    await sql()`
      update glyph_runs set finished_at = now(), client_end_tick = ${Number(body.endTick) || null}, reject_reason = ${verdict.reason}
      where id = ${runId} and finished_at is null`;
    throw new HttpError(400, verdict.reason);
  }

  const { result, runes, reward } = verdict;
  const rewardTotal = Object.values(reward).reduce((a, b) => a + b, 0);
  // Finishing is the single-use gate: only one submission can flip finished_at.
  const finished = await sql()`
    update glyph_runs set
      finished_at = now(), end_tick = ${result.endTick}, client_end_tick = ${body.endTick}, distance_mm = ${result.distanceMm},
      died = ${result.died}, runes = ${result.collected.length}, reward = ${rewardTotal}
    where id = ${runId} and finished_at is null
    returning id`;
  if (finished.length === 0) throw new HttpError(409, "this run was already submitted");

  await addMaterials(user.id, reward);
  const [before] = await sql()`select best_mm from glyph_players where telegram_id = ${user.id}`;
  const [after] = await sql()`
    update glyph_players set best_mm = greatest(best_mm, ${result.distanceMm})
    where telegram_id = ${user.id} returning best_mm`;
  if (verdict.desync) console.warn(`glyph run ${runId}: client and replay disagree (client ${body.endTick}, replay ${result.endTick})`);

  return {
    distanceMm: result.distanceMm,
    endTick: result.endTick,
    died: result.died,
    runes,
    reward,
    capped: verdict.capped,
    materials: await materialsOf(user.id),
    bestMm: after.best_mm,
    personalBest: result.distanceMm > before.best_mm,
  };
});
