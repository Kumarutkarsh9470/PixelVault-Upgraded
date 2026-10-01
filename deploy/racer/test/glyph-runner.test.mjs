import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { generateRows, inputProblem, JUMP, LEFT, MAX_TICKS, simulate } from "../api/glyph/_lib/runner.js";
import { playBot } from "./glyph-bot.mjs";

const vectors = JSON.parse(fs.readFileSync(new URL("../../../glyph/level/vectors.json", import.meta.url)));

test("rules still produce the committed vectors (regenerate with tools/glyph-vectors.mjs)", () => {
  for (const r of vectors.rows) {
    assert.equal(Array.from(generateRows(r.seed, r.count)).join(""), r.cells, `rows for seed ${r.seed}`);
  }
  for (const run of vectors.runs) {
    assert.deepEqual(simulate(run.seed, run.inputs, run.endTick), run.expect, run.name);
  }
});

test("every level can be survived for the full ten minutes", () => {
  for (let i = 1; i <= 40; i++) {
    const seed = (i * 2654435761) >>> 0;
    const { sim } = playBot(seed, { maxTicks: MAX_TICKS });
    assert.equal(sim.dead, false, `seed ${seed} killed a perfect player at row ${sim.deathRow}`);
  }
});

test("malformed input logs are refused before replay", () => {
  assert.equal(inputProblem([], 600), null);
  assert.equal(inputProblem([[0, LEFT], [5, JUMP]], 600), null);
  assert.match(inputProblem([], 0), /out of range/);
  assert.match(inputProblem([], MAX_TICKS + 1), /out of range/);
  assert.match(inputProblem([[5, LEFT], [5, JUMP]], 600), /increase/);
  assert.match(inputProblem([[9, LEFT], [5, JUMP]], 600), /increase/);
  assert.match(inputProblem([[600, LEFT]], 600), /increase/);
  assert.match(inputProblem([[1, 7]], 600), /unknown/);
  assert.match(inputProblem([[1.5, LEFT]], 600), /increase/);
  assert.match(inputProblem(Array.from({ length: 300 }, (_, i) => [i, LEFT]), 600), /too many/);
});
