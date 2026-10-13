// Turns each track's control points into the circuit both the game and the
// chain simulate: an evenly spaced centreline in fixed point, its checkpoints
// and its boost pads.
//
// This is the single source of that geometry. The client never re-derives it
// and the registration tool uploads exactly these numbers, so a run replayed
// on-chain meets the same corners the player drove.
//
// Usage: node tools/build-circuits.mjs
import fs from "node:fs";

/// Q16.16, matching the simulation.
const ONE = 65536;
/// Metres between centreline samples.
const SPACING = 2;
/// Lateral distance from the centreline to the walls: half the road, the kerb
/// and the gap to the rail, as TrackBuilder lays them out.
const WALL_OFFSET = 10;
const CHECKPOINT_SPACING = 55;
/// 2^32 / 360, as the simulation's heading units.
const PER_DEGREE = 11_930_465;
/// Samples the car starts behind the line.
const GRID_OFFSET = 4;
const PAD_LATERAL = 2.8;

const toFixed = (value) => Math.round(value * ONE);

const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function catmullRom(p0, p1, p2, p3, t) {
  const knot = (t, a, b) => t + Math.max(Math.sqrt(distance(a, b)), 1e-4);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const blend = (a, b, ta, tb) => [
    ((tb - u) / (tb - ta)) * a[0] + ((u - ta) / (tb - ta)) * b[0],
    ((tb - u) / (tb - ta)) * a[1] + ((u - ta) / (tb - ta)) * b[1],
  ];
  const a1 = blend(p0, p1, t0, t1);
  const a2 = blend(p1, p2, t1, t2);
  const a3 = blend(p2, p3, t2, t3);
  return blend(blend(a1, a2, t0, t2), blend(a2, a3, t1, t3), t1, t2);
}

/// Evenly spaced samples around a closed centripetal Catmull-Rom loop.
function centreline(flat) {
  const controls = [];
  for (let i = 0; i + 1 < flat.length; i += 2) controls.push([flat[i], flat[i + 1]]);

  const n = controls.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((d) => controls[(i + d + n) % n]);
    for (let s = 0; s < 48; s++) dense.push(catmullRom(p0, p1, p2, p3, s / 48));
  }

  let total = 0;
  for (let i = 0; i < dense.length; i++) total += distance(dense[i], dense[(i + 1) % dense.length]);
  const count = Math.max(16, Math.round(total / SPACING));
  const step = total / count;

  const positions = [];
  let segment = 0;
  let walked = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    let length = distance(dense[segment], dense[(segment + 1) % dense.length]);
    while (walked + length < target && segment < dense.length - 1) {
      walked += length;
      segment++;
      length = distance(dense[segment], dense[(segment + 1) % dense.length]);
    }
    const t = length > 0 ? (target - walked) / length : 0;
    const a = dense[segment];
    const b = dense[(segment + 1) % dense.length];
    positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  const samples = [];
  for (let k = 0; k < count; k++) {
    const previous = positions[(k + count - 1) % count];
    const next = positions[(k + 1) % count];
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.max(Math.hypot(dx, dz), 1e-9);
    samples.push(toFixed(positions[k][0]), toFixed(positions[k][1]), toFixed(dx / length), toFixed(dz / length));
  }
  return { samples, count, lapMeters: total };
}

/// The heading that points along a sample's direction of travel, wrapped into
/// the simulation's unsigned turn.
function headingOf(samples, index) {
  const fx = samples[index * 4 + 2] / ONE;
  const fz = samples[index * 4 + 3] / ONE;
  const degrees = (Math.atan2(fx, fz) * 180) / Math.PI;
  return Math.trunc(degrees * PER_DEGREE) >>> 0;
}

const data = JSON.parse(fs.readFileSync(new URL("../web/src/data/tracks.json", import.meta.url)));
const circuits = {};

for (const track of data.tracks) {
  const { samples, count, lapMeters } = centreline(track.points);
  const checkpointCount = Math.max(8, Math.round(lapMeters / CHECKPOINT_SPACING));
  const checkpoints = [];
  for (let i = 0; i < checkpointCount; i++) checkpoints.push(Math.floor((i * count) / checkpointCount));

  const startSample = count - GRID_OFFSET;
  const pads = [
    [Math.floor(count / 5), -PAD_LATERAL],
    [Math.floor(count / 2), PAD_LATERAL],
    [Math.floor((count * 4) / 5), -PAD_LATERAL],
  ];

  circuits[track.id] = {
    laps: track.laps,
    spacing: toFixed(SPACING),
    wallOffset: toFixed(WALL_OFFSET),
    startSample,
    startHeading: headingOf(samples, startSample),
    sampleCount: count,
    lapMeters: Math.round(lapMeters),
    checkpoints,
    padSamples: pads.map(([sample]) => sample),
    padLaterals: pads.map(([, lateral]) => toFixed(lateral)),
    samples,
  };
  console.log(
    `${track.id}: ${count} samples, ${Math.round(lapMeters)} m lap, ` +
      `${checkpoints.length} checkpoints, start ${startSample}`,
  );
}

const out = new URL("../web/src/data/circuits.json", import.meta.url);
fs.writeFileSync(out, JSON.stringify(circuits) + "\n");
console.log(`wrote ${(fs.statSync(out).size / 1024).toFixed(0)} KB to web/src/data/circuits.json`);
