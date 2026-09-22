// Called when the Mini App opens: identifies the player from Telegram's
// signed launch data, links their embedded wallet, and returns their state.
import { readBody, route } from "./_lib/http.js";
import { bestTimesOf, materialsOf, reconcileGrants, upsertPlayer } from "./_lib/players.js";
import { verifyInitData } from "./_lib/telegram.js";
import { sql } from "./_lib/db.js";

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  const player = await upsertPlayer(user, body.wallet);
  await reconcileGrants(user.id);

  const [materials, bests, open] = await Promise.all([
    materialsOf(user.id),
    bestTimesOf(user.id),
    sql()`select game_id, class_id, seq, expires_at from grants where telegram_id = ${user.id} and status = 'issued'`,
  ]);
  return {
    player: {
      telegramId: user.id,
      username: player.username,
      wallet: player.wallet,
      starterGranted: !!player.starter_granted_at,
    },
    materials,
    bests,
    openGrant: open[0] ?? null,
  };
});
