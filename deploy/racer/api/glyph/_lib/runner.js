// Glyph Forge run rules: the level a seed produces, and what a list of inputs
// does on it. Integer-only and tick-based so the Unity client
// (glyph/game/Assets/Scripts/Sim/RunnerSim.cs) and this server compute exactly
// the same run. Any change here must be mirrored there and the vectors
// regenerated: node tools/glyph-vectors.mjs
export const TICK_HZ = 60;
/** Distance between rows of the level. Row r sits at (r + 1) * ROW_MM. */
export const ROW_MM = 8000;
export const SAFE_ROWS = 6;
export const ROWS_PER_TIER = 40;
export const MAX_TIER = 4;
/** Forward speed in millimetres per tick: 12 m/s rising to 28 m/s over about 107 s. */
export const V0_MM = 200;
export const VMAX_MM = 467;
export const ACCEL_EVERY = 24;
/** A lane change takes effect this many ticks after the input (half of the 9-tick animation). */
export const LANE_DELAY = 4;
export const JUMP_TICKS = 30;
export const SLIDE_TICKS = 30;
/** Ten minutes. */
export const MAX_TICKS = 36_000;

export const EMPTY = 0;
export const WALL = 1;
export const LOW = 2;
export const HIGH = 3;
export const EMBER = 4;
export const TIDE = 5;
export const STORM = 6;

export const LEFT = 0;
export const RIGHT = 1;
export const JUMP = 2;
export const SLIDE = 3;

const W = WALL;
const L = LOW;
const H = HIGH;
const _ = EMPTY;
/** Obstacle rows, easiest first. Every pattern leaves at least one way through. */
export const PATTERNS = [
  [W, _, _], [_, W, _], [_, _, W], [L, _, _], [_, L, _], [_, _, L],
  [W, W, _], [_, W, W], [W, _, W], [L, L, L], [H, _, _], [_, H, _], [_, _, H],
  [H, H, H], [W, L, W], [W, H, W], [L, W, L],
  [L, H, W], [W, H, L], [H, W, L], [L, W, H],
  [W, W, L], [L, W, W], [W, W, H], [H, W, W],
];
/** How many of PATTERNS each difficulty tier draws from. */
export const PATTERN_COUNTS = [6, 13, 17, 21, 25];

/** mulberry32: a 32-bit generator that is easy to reproduce exactly in C#. */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** The first `count` rows of a seed's level: three cells per row, left to right. */
export function generateRows(seed, count) {
  const next = random(seed);
  const cells = new Uint8Array(count * 3);
  let runLane = 0;
  let runLeft = 0;
  let runType = EMBER;
  for (let r = SAFE_ROWS; r < count; r++) {
    const tier = Math.min(MAX_TIER, Math.floor((r - SAFE_ROWS) / ROWS_PER_TIER));
    const base = r * 3;
    if ((r & 1) === 1) {
      if (next() % 100 < 45 + tier * 10) {
        const pattern = PATTERNS[next() % PATTERN_COUNTS[tier]];
        cells[base] = pattern[0];
        cells[base + 1] = pattern[1];
        cells[base + 2] = pattern[2];
      }
    } else {
      if (runLeft === 0 && next() % 100 < 40) {
        runLane = next() % 3;
        runLeft = 3 + (next() % 4);
        const roll = next() % 100;
        const storm = 10 + tier * 5;
        runType = roll < storm ? STORM : roll < storm + 35 ? TIDE : EMBER;
      }
      if (runLeft > 0) {
        cells[base + runLane] = runType;
        runLeft--;
      }
    }
  }
  return cells;
}

export const speedAt = (tick) => Math.min(VMAX_MM, V0_MM + Math.floor(tick / ACCEL_EVERY));

/** Rows a run of `ticks` can reach, plus margin. */
export const rowsFor = (ticks) => Math.floor((ticks * VMAX_MM) / ROW_MM) + 2;

/** One run, advanced a tick at a time. The client drives it live; the server replays recorded inputs. */
export class RunnerSim {
  constructor(seed, maxTicks = MAX_TICKS) {
    this.rows = generateRows(seed, rowsFor(maxTicks));
    this.tick = 0;
    this.lane = 1;
    this.pendingLane = -1;
    this.pendingAt = 0;
    this.airUntil = 0;
    this.slideUntil = 0;
    this.distanceMm = 0;
    this.nextRow = 0;
    this.dead = false;
    this.deathRow = -1;
    /** [row, type] for every rune picked up. */
    this.collected = [];
  }

  cell(row, lane) {
    return this.rows[row * 3 + lane];
  }

  /** Applies an input at the current tick, before step(). */
  input(action) {
    const tick = this.tick;
    if (action === LEFT || action === RIGHT) {
      const target = (this.pendingLane >= 0 ? this.pendingLane : this.lane) + (action === LEFT ? -1 : 1);
      if (target >= 0 && target <= 2) {
        this.pendingLane = target;
        this.pendingAt = tick + LANE_DELAY;
      }
    } else if (tick >= this.airUntil && tick >= this.slideUntil) {
      if (action === JUMP) this.airUntil = tick + JUMP_TICKS;
      else if (action === SLIDE) this.slideUntil = tick + SLIDE_TICKS;
    }
  }

  /** Advances one tick: settles lane changes, moves forward, resolves every row crossed. */
  step() {
    if (this.dead) return;
    const tick = this.tick;
    if (this.pendingLane >= 0 && tick >= this.pendingAt) {
      this.lane = this.pendingLane;
      this.pendingLane = -1;
    }
    this.distanceMm += speedAt(tick);
    this.tick = tick + 1;
    while ((this.nextRow + 1) * ROW_MM <= this.distanceMm) {
      const cell = this.cell(this.nextRow, this.lane);
      const blocked =
        cell === WALL || (cell === LOW && tick >= this.airUntil) || (cell === HIGH && tick >= this.slideUntil);
      if (blocked) {
        this.dead = true;
        this.deathRow = this.nextRow;
        return;
      }
      if (cell >= EMBER) this.collected.push([this.nextRow, cell]);
      this.nextRow++;
    }
  }
}

/** Replays inputs ([tick, action] pairs, strictly increasing ticks) for at most endTick ticks. */
export function simulate(seed, inputs, endTick) {
  const sim = new RunnerSim(seed, endTick);
  let i = 0;
  while (sim.tick < endTick && !sim.dead) {
    while (i < inputs.length && inputs[i][0] === sim.tick) sim.input(inputs[i++][1]);
    sim.step();
  }
  return { endTick: sim.tick, died: sim.dead, deathRow: sim.deathRow, distanceMm: sim.distanceMm, collected: sim.collected };
}

/** Why an input list is malformed, or null. Checked before simulating. */
export function inputProblem(inputs, endTick) {
  if (!Number.isInteger(endTick) || endTick < 1 || endTick > MAX_TICKS) return "run length out of range";
  if (!Array.isArray(inputs) || inputs.length > Math.floor(endTick / 3) + 20) return "too many inputs";
  let previous = -1;
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length !== 2) return "malformed input";
    const [tick, action] = entry;
    if (!Number.isInteger(tick) || tick <= previous || tick >= endTick) return "input ticks must increase within the run";
    if (![LEFT, RIGHT, JUMP, SLIDE].includes(action)) return "unknown input";
    previous = tick;
  }
  return null;
}
