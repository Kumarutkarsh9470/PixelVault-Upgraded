// What a submitted Glyph Forge run earns: replayed, timed against the clock, capped.
import assert from "node:assert/strict";
import { test } from "node:test";

import { CLOCK_SLACK_MS, judgeRun, SUBMIT_GRACE_MS } from "../api/glyph/_lib/judge.js";
import { EMBER, MAX_TICKS, STORM, TICK_HZ, TIDE } from "../api/glyph/_lib/runner.js";
import { playBot } from "./glyph-bot.mjs";

const runeMaterial = { [EMBER]: "ember-rune", [TIDE]: "tide-rune", [STORM]: "storm-rune" };
const SEED = 424242;
const bot = playBot(SEED, { maxTicks: 5400 }); // a 90-second run
const runMs = (bot.endTick * 1000) / TICK_HZ;
const claim = { inputs: bot.inputs, endTick: bot.endTick, died: bot.sim.dead };
const context = (over = {}) => ({ nowMs: runMs + 2000, earnedToday: 0, dailyCap: 1000, runeMaterial, ...over });
const run = { seed: SEED, startedAtMs: 0 };

test("a played run earns exactly the runes its replay collected", () => {
  const verdict = judgeRun(run, claim, context());
  assert.equal(verdict.valid, true);
  assert.equal(verdict.desync, false);
  assert.equal(verdict.result.distanceMm, bot.sim.distanceMm);
  const total = Object.values(verdict.reward).reduce((a, b) => a + b, 0);
  assert.equal(total, bot.sim.collected.length);
  assert.ok(total > 10, "the bot should collect runes in 90 s");
});

test("the replay, not the client, decides how the run ended", () => {
  // Claims the full run length while dropping every input after the first 20 s: the replay dies early.
  const truncated = { inputs: bot.inputs.filter(([t]) => t < 1200), endTick: bot.endTick, died: false };
  const verdict = judgeRun(run, truncated, context());
  assert.equal(verdict.valid, true);
  assert.equal(verdict.result.died, true);
  assert.ok(verdict.result.endTick < bot.endTick);
  assert.equal(verdict.desync, true);
});

test("a run cannot be longer than the time since its seed was issued", () => {
  const tooFast = judgeRun(run, claim, context({ nowMs: runMs - CLOCK_SLACK_MS - 1 }));
  assert.equal(tooFast.valid, false);
  assert.match(tooFast.reason, /longer than the time/);
  assert.equal(judgeRun(run, claim, context({ nowMs: runMs - CLOCK_SLACK_MS + 1 })).valid, true);
});

test("a run must be submitted before it expires", () => {
  const late = (MAX_TICKS / TICK_HZ) * 1000 + SUBMIT_GRACE_MS + 1;
  assert.match(judgeRun(run, claim, context({ nowMs: late })).reason, /expired/);
});

test("rewards stop at the daily cap, in collection order", () => {
  const verdict = judgeRun(run, claim, context({ dailyCap: 60, earnedToday: 55 }));
  assert.equal(Object.values(verdict.reward).reduce((a, b) => a + b, 0), 5);
  assert.equal(verdict.capped, true);
  const none = judgeRun(run, claim, context({ dailyCap: 60, earnedToday: 60 }));
  assert.deepEqual(none.reward, {});
  assert.ok(Object.values(none.runes).reduce((a, b) => a + b, 0) > 0, "runes are still reported");
});

test("malformed input logs are refused", () => {
  assert.equal(judgeRun(run, { inputs: [[5, 0], [5, 1]], endTick: 600 }, context()).valid, false);
  assert.equal(judgeRun(run, { inputs: "nope", endTick: 600 }, context()).valid, false);
  assert.equal(judgeRun(run, { inputs: [], endTick: MAX_TICKS + 1 }, context()).valid, false);
});

test("a different seed replays differently", () => {
  const other = judgeRun({ seed: SEED + 1, startedAtMs: 0 }, claim, context());
  assert.equal(other.valid, true);
  assert.notEqual(other.result.distanceMm, bot.sim.distanceMm);
});
