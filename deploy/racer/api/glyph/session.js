// Glyph Forge: identifies the player from Telegram launch data, links their wallet, returns their state.
import { sql } from "../_lib/db.js";
import { readBody, route } from "../_lib/http.js";
import { verifyInitData } from "../_lib/telegram.js";
import { materialsOf, reconcileGrants, upsertRunner, verifiedFrame } from "./_lib/studio.js";

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  const player = await upsertRunner(user, body.wallet);
  await reconcileGrants(user.id);
  if (body.frame !== undefined) {
    await sql()`update glyph_players set frame = ${await verifiedFrame(player.wallet, body.frame)} where telegram_id = ${user.id}`;
  }
  const [materials, open] = await Promise.all([
    materialsOf(user.id),
    sql()`select class_id, seq, expires_at from glyph_grants where telegram_id = ${user.id} and status = 'issued'`,
  ]);
  return {
    player: { telegramId: user.id, name: player.name, wallet: player.wallet, bestMm: player.best_mm },
    materials,
    openGrant: open[0] ?? null,
  };
});
