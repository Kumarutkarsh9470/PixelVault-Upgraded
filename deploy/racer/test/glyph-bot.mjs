// A Glyph Forge player with perfect knowledge of the level, for tests: it
// shows every level is survivable and produces realistic input logs.
import { HIGH, JUMP, LEFT, LOW, RIGHT, RunnerSim, ROW_MM, SLIDE, WALL, EMBER, speedAt } from "../api/glyph/_lib/runner.js";

/** Plays a seed until it dies, reaches maxTicks, or (with blindAfterRow) stops dodging after that row. */
export function playBot(seed, { maxTicks, blindAfterRow = Infinity } = {}) {
  const sim = new RunnerSim(seed, maxTicks);
  const inputs = [];
  const press = (action) => {
    inputs.push([sim.tick, action]);
    sim.input(action);
  };

  while (sim.tick < maxTicks && !sim.dead) {
    const row = sim.nextRow;
    if (row < blindAfterRow) {
      const target = chooseLane(sim, row);
      const current = sim.pendingLane >= 0 ? sim.pendingLane : sim.lane;
      if (target !== current && sim.pendingLane < 0) {
        press(target < current ? LEFT : RIGHT);
      } else if (sim.pendingLane < 0) {
        const cell = sim.cell(row, sim.lane);
        const ticksToRow = Math.ceil(((row + 1) * ROW_MM - sim.distanceMm) / speedAt(sim.tick));
        const free = sim.tick >= sim.airUntil && sim.tick >= sim.slideUntil;
        if (free && ticksToRow <= 12) {
          if (cell === LOW) press(JUMP);
          else if (cell === HIGH) press(SLIDE);
        }
      }
    }
    sim.step();
  }
  return { inputs, endTick: sim.tick, sim };
}

/** The lane to be in for the next obstacle row: survivable, close, and with a rune on the way if possible. */
function chooseLane(sim, row) {
  const obstacleRow = row % 2 === 1 ? row : row + 1;
  const current = sim.pendingLane >= 0 ? sim.pendingLane : sim.lane;
  const lanes = [0, 1, 2].filter((lane) => sim.cell(obstacleRow, lane) !== WALL);
  const score = (lane) =>
    Math.abs(lane - current) * 2 - (sim.cell(obstacleRow + 1, lane) >= EMBER ? 1 : 0) - (sim.cell(row, lane) >= EMBER && row % 2 === 0 ? 1 : 0);
  return lanes.sort((a, b) => score(a) - score(b))[0];
}
