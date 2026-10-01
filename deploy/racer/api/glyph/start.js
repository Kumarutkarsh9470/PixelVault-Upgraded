// Glyph Forge: issues the seed for a new run. Starting abandons any unfinished
// run, so a player has one live run at a time and cannot shop for good seeds.
import { randomInt } from "node:crypto";

import { sql } from "../_lib/db.js";
import { HttpError, readBody, route } from "../_lib/http.js";
import { verifyInitData } from "../_lib/telegram.js";
import { upsertRunner } from "./_lib/studio.js";

const MAX_STARTS_PER_HOUR = 120;

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  await upsertRunner(user, body.wallet);

  const [{ n }] = await sql()`
    select count(*)::int as n from glyph_runs where telegram_id = ${user.id} and started_at > now() - interval '1 hour'`;
  if (n >= MAX_STARTS_PER_HOUR) throw new HttpError(429, "too many runs this hour; take a breather");

  await sql()`
    update glyph_runs set finished_at = now(), reject_reason = 'abandoned'
    where telegram_id = ${user.id} and finished_at is null`;
  const seed = randomInt(0, 2 ** 32);
  const [run] = await sql()`insert into glyph_runs (telegram_id, seed) values (${user.id}, ${seed}) returning id`;
  return { runId: String(run.id), seed };
});
