import { sql } from "./_lib/db.js";
import { findTrack } from "./_lib/game.js";
import { route } from "./_lib/http.js";

export default route(["GET"], async (req) => {
  const track = findTrack(new URL(req.url, "http://localhost").searchParams.get("track"));
  const rows = await sql()`
    select b.total_ms, b.achieved_at, coalesce(p.username, p.first_name, 'racer') as name
    from best_times b join players p using (telegram_id)
    where b.track_id = ${track.id}
    order by b.total_ms asc
    limit 20`;
  return {
    track: track.id,
    entries: rows.map((r, i) => ({ rank: i + 1, name: r.name, totalMs: r.total_ms, at: r.achieved_at })),
  };
});
