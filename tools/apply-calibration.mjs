// Turns an autopilot calibration run (CalibrationRunner in the Unity game)
// into medal times and the "Nova" rival: gold sits just above the autopilot's
// fastest clean run, so beating it takes clean lines plus drift boosts.
// Usage: node tools/apply-calibration.mjs <rivals.json from the calibration build>
import fs from "node:fs";

const MEDAL_FACTORS = { gold: 1.04, silver: 1.14, bronze: 1.3 };
const TOP_SPEED_MPS = 62;

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tracksUrl = new URL("../web/src/data/tracks.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(tracksUrl, "utf8"));

const rivals = {};
for (const run of input.rivals) {
  const track = data.tracks.find((t) => t.id === run.trackId);
  if (!track) continue;
  const round = (ms) => Math.round(ms / 10) * 10;
  track.medals = {
    gold: round(run.totalMs * MEDAL_FACTORS.gold),
    silver: round(run.totalMs * MEDAL_FACTORS.silver),
    bronze: round(run.totalMs * MEDAL_FACTORS.bronze),
  };
  track.minPlausibleMs = Math.round(((track.lapMeters * track.laps) / TOP_SPEED_MPS) * 1000 * 0.92);
  rivals[run.trackId] = {
    name: input.driver || "Nova",
    totalMs: run.totalMs,
    splits: run.splits,
    ghost: {
      interval: run.ghost.interval,
      samples: run.ghost.samples.map((v) => Math.round(v * 100) / 100),
    },
  };
  console.log(run.trackId, "rival", run.totalMs, "medals", track.medals, "floor", track.minPlausibleMs);
}

fs.writeFileSync(tracksUrl, JSON.stringify(data, null, 2) + "\n");
fs.writeFileSync(new URL("../web/src/data/rivals.json", import.meta.url), JSON.stringify(rivals) + "\n");
