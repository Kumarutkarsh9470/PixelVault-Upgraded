// Computes each track's centreline length with the same centripetal
// Catmull-Rom sampling Unity uses (TrackPath.cs), and prints the medal
// thresholds and anti-cheat floor derived from it.
// Usage: node tools/track-lengths.mjs
import fs from "node:fs";

const { tracks } = JSON.parse(fs.readFileSync(new URL("../web/src/data/tracks.json", import.meta.url)));

const knot = (t, a, b) => t + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4);
const blend = (a, b, ta, tb, u) => [
  ((tb - u) / (tb - ta)) * a[0] + ((u - ta) / (tb - ta)) * b[0],
  ((tb - u) / (tb - ta)) * a[1] + ((u - ta) / (tb - ta)) * b[1],
];

function catmullRom(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const a1 = blend(p0, p1, t0, t1, u);
  const a2 = blend(p1, p2, t1, t2, u);
  const a3 = blend(p2, p3, t2, t3, u);
  const b1 = blend(a1, a2, t0, t2, u);
  const b2 = blend(a2, a3, t1, t3, u);
  return blend(b1, b2, t1, t2, u);
}

function length(flat) {
  const controls = [];
  for (let i = 0; i + 1 < flat.length; i += 2) controls.push([flat[i], flat[i + 1]]);
  const n = controls.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((d) => controls[(i + d + n) % n]);
    for (let s = 0; s < 48; s++) dense.push(catmullRom(p0, p1, p2, p3, s / 48));
  }
  let total = 0;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % dense.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

// Rough medal paces for new tracks; tools/apply-calibration.mjs sets the real ones from autopilot runs.
const GOLD_MPS = 35;
const SILVER_MPS = 31;
const BRONZE_MPS = 26;
const TOP_SPEED_MPS = 62;

for (const track of tracks) {
  const lap = length(track.points);
  const race = lap * track.laps;
  const ms = (mps) => Math.round((race / mps) * 1000);
  console.log(
    JSON.stringify({
      id: track.id,
      lapMeters: Math.round(lap),
      raceMeters: Math.round(race),
      medals: { gold: ms(GOLD_MPS), silver: ms(SILVER_MPS), bronze: ms(BRONZE_MPS) },
      // No legitimate run can average more than top speed along the centreline.
      minPlausibleMs: Math.round((race / TOP_SPEED_MPS) * 1000 * 0.92),
    }),
  );
}
