// Game rules on the server: which runs are plausible, which medal a time
// earns, and what materials that pays out. Reads the same data files the
// client ships.
import fs from "node:fs";

import { HttpError } from "./http.js";

const load = (file) => JSON.parse(fs.readFileSync(new URL(`../../data/${file}`, import.meta.url)));

export const { tracks } = load("tracks.json");
export const catalog = load("catalog.json");

const CHECKPOINT_SPACING_M = 55;
const TOP_SPEED_MPS = 46;

export function findTrack(id) {
  const track = tracks.find((t) => t.id === id);
  if (!track) {
    throw new HttpError(400, `unknown track ${id}`);
  }
  return track;
}

export function findItem(gameId, classId) {
  const game = catalog.games.find((g) => g.gameId === gameId);
  const item = game?.items.find((i) => i.classId === classId);
  if (!item) {
    throw new HttpError(400, `unknown item ${gameId}/${classId}`);
  }
  return { game, item };
}

/** Mirrors TrackBuilder.BuildCheckpoints in the Unity client. */
export function checkpointCount(track) {
  return Math.max(8, Math.round(track.lapMeters / CHECKPOINT_SPACING_M));
}

/**
 * Server-side plausibility checks on a reported run. The client records the
 * race time at every checkpoint crossing; a genuine run has the right number
 * of crossings, in increasing order, none faster than top speed allows.
 * Returns null if plausible, otherwise the reason it was rejected.
 */
export function rejectReason(track, run) {
  const { totalMs, laps, splits } = run;
  if (laps !== track.laps) {
    return "wrong lap count";
  }
  if (!Number.isInteger(totalMs) || totalMs < track.minPlausibleMs) {
    return "faster than physically possible";
  }
  if (!Array.isArray(splits)) {
    return "missing splits";
  }
  const perLap = checkpointCount(track);
  if (splits.length !== perLap * track.laps) {
    return `expected ${perLap * track.laps} checkpoint splits, got ${splits.length}`;
  }
  if (splits[splits.length - 1] !== totalMs) {
    return "final split does not match total time";
  }

  // No segment between checkpoints may be driven faster than top speed.
  const segmentMeters = track.lapMeters / perLap;
  const minSegmentMs = (segmentMeters / TOP_SPEED_MPS) * 1000 * 0.8;
  let previous = 0;
  for (const split of splits) {
    if (!Number.isInteger(split) || split - previous < minSegmentMs) {
      return "a checkpoint segment was impossibly fast";
    }
    previous = split;
  }
  return null;
}

export function medalFor(track, totalMs) {
  if (totalMs <= track.medals.gold) return "gold";
  if (totalMs <= track.medals.silver) return "silver";
  if (totalMs <= track.medals.bronze) return "bronze";
  return null;
}

export function materialFor(track) {
  const material = catalog.materials.find((m) => m.track === track.id);
  if (!material) {
    throw new Error(`no material configured for ${track.id}`);
  }
  return material.id;
}

export function rewardFor(medal) {
  return medal ? catalog.medalRewards[medal] : 0;
}
