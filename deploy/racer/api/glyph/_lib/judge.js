// Decides what a submitted run earned, by replaying it. Pure: no database.
import { inputProblem, MAX_TICKS, simulate, TICK_HZ } from "./runner.js";

/** Slack for network latency and clock skew when comparing run length to wall-clock time. */
export const CLOCK_SLACK_MS = 3000;
/** A run must be submitted within its maximum length plus this. */
export const SUBMIT_GRACE_MS = 5 * 60 * 1000;

/**
 * @param run      { seed, startedAtMs } as issued by /api/glyph/start
 * @param claim    { inputs, endTick } from the client
 * @param context  { nowMs, earnedToday, dailyCap, runeMaterial }
 */
export function judgeRun(run, claim, context) {
  const problem = inputProblem(claim.inputs, claim.endTick);
  if (problem) return { valid: false, reason: problem };

  const elapsedMs = context.nowMs - run.startedAtMs;
  if (elapsedMs > (MAX_TICKS / TICK_HZ) * 1000 + SUBMIT_GRACE_MS) {
    return { valid: false, reason: "this run expired before it was submitted" };
  }
  // The game runs at 60 ticks a second: a run cannot be longer than the time since its seed was issued.
  if ((claim.endTick * 1000) / TICK_HZ > elapsedMs + CLOCK_SLACK_MS) {
    return { valid: false, reason: "run is longer than the time since it started" };
  }

  // The replay is the truth: if the client's own simulation disagrees, the server's result stands.
  const result = simulate(run.seed, claim.inputs, claim.endTick);
  const runes = {};
  const reward = {};
  let allowance = Math.max(0, context.dailyCap - context.earnedToday);
  for (const [, type] of result.collected) {
    const material = context.runeMaterial[type];
    runes[material] = (runes[material] ?? 0) + 1;
    if (allowance > 0) {
      reward[material] = (reward[material] ?? 0) + 1;
      allowance--;
    }
  }
  return {
    valid: true,
    reason: null,
    result,
    runes,
    reward,
    capped: result.collected.length > Math.max(0, context.dailyCap - context.earnedToday),
    desync: result.endTick !== claim.endTick || result.died !== claim.died,
  };
}
