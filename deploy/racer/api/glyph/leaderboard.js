// Glyph Forge: the longest runs, with the frame each runner owns on-chain.
import { sql } from "../_lib/db.js";
import { route } from "../_lib/http.js";

export default route(["GET"], async () => {
  const rows = await sql()`
    select name, frame, best_mm from glyph_players
    where best_mm > 0 order by best_mm desc limit 20`;
  return { entries: rows.map((r, i) => ({ rank: i + 1, name: r.name ?? "runner", frame: r.frame, distanceMm: r.best_mm })) };
});
