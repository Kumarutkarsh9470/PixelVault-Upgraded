// The fastest recorded line on a track, so players can race the leader's ghost.
import { sql } from "./_lib/db.js";
import { findTrack } from "./_lib/game.js";
import { route } from "./_lib/http.js";

export default route(["GET"], async (req, res) => {
  const track = findTrack(new URL(req.url, "http://localhost").searchParams.get("track"));
  const [row] = await sql()`
    select b.total_ms, b.ghost, b.splits, coalesce(p.username, p.first_name, 'racer') as name
    from best_times b join players p using (telegram_id)
    where b.track_id = ${track.id} and b.ghost is not null
    order by b.total_ms asc
    limit 1`;
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  if (!row) return { track: track.id, leader: null };
  return {
    track: track.id,
    leader: { name: row.name, totalMs: row.total_ms, splits: row.splits ?? [], ghost: row.ghost },
  };
});
