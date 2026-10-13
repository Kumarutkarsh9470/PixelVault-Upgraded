import type { RunResult } from "../lib/api";
import { formatTime } from "../lib/api";
import type { Opponent } from "../lib/opponents";
import type { RaceFinished } from "../lib/unity";
import { AnimatedNumber, Confetti } from "../components/Fx";
import { MaterialChip, MedalBadge, Sheet, Stat } from "../components/ui";
import { tracks } from "./Home";
import { formatDelta } from "./Race";

export function Results({
  finished,
  opponent,
  previousBest,
  result,
  error,
  onAgain,
  onGarage,
  onHome,
}: {
  finished: RaceFinished;
  opponent: Opponent | null;
  previousBest: number | null;
  result: RunResult | null;
  error: string | null;
  onAgain: () => void;
  onGarage: () => void;
  onHome: () => void;
}) {
  const track = tracks.find((t) => t.id === finished.trackId);
  return (
    <div className="screen results">
      <Sheet>
        <p className="eyebrow">{track?.name}</p>
        <div className="result-time">
          <AnimatedNumber value={finished.totalMs} format={formatTime} duration={900} />
        </div>
        <div className="result-deltas">
          {opponent && (
            <span className={finished.totalMs < opponent.totalMs ? "ahead" : "behind"}>
              {formatDelta(finished.totalMs - opponent.totalMs)} vs {opponent.name}
            </span>
          )}
          {previousBest != null && (
            <span className={finished.totalMs < previousBest ? "ahead" : "behind"}>
              {formatDelta(finished.totalMs - previousBest)} vs your best
            </span>
          )}
        </div>

        {!result && !error && <p className="muted">Checking your run…</p>}
        {error && <p className="error">Couldn't save this run: {error}</p>}

        {result && (
          <>
            {(result.medal === "gold" || result.personalBest) && <Confetti />}
            <div className="result-medal reveal">
              <MedalBadge medal={result.medal} size="lg" />
              {result.personalBest && <span className="pb">New personal best</span>}
            </div>
            {!result.valid && <p className="error">Run rejected: {result.reason}</p>}
            {result.valid && track && result.medal !== "gold" && <NextMedal totalMs={finished.totalMs} medals={track.medals} />}

            <div className="stats stagger">
              <Stat label="Best" value={formatTime(result.best)} />
              <Stat label="Rank" value={result.rank ? `#${result.rank}` : "—"} />
              <Stat label="Respawns" value={finished.respawns} />
            </div>

            {track && <MedalLadder totalMs={finished.totalMs} medals={track.medals} />}
            {opponent && opponent.splits.length > 0 && finished.splits.length > 0 && (
              <SectorBars mine={finished.splits} theirs={opponent.splits} name={opponent.name} />
            )}

            {result.reward.amount > 0 ? (
              <div className="reward pop-in">
                <span className="muted">Earned</span>
                <MaterialChip id={result.reward.material} amount={result.reward.amount} />
              </div>
            ) : (
              result.valid &&
              result.medal && <p className="muted small">Daily material limit reached on this track.</p>
            )}
          </>
        )}

        <div className="actions">
          <button className="primary" onClick={onAgain}>
            Race again
          </button>
          <button onClick={onGarage}>Garage</button>
          <button className="ghost" onClick={onHome}>
            Tracks
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function NextMedal({ totalMs, medals }: { totalMs: number; medals: { gold: number; silver: number; bronze: number } }) {
  const next = (["bronze", "silver", "gold"] as const).find((m) => totalMs > medals[m]);
  if (!next) return null;
  return (
    <p className="muted small">
      {((totalMs - medals[next]) / 1000).toFixed(2)}s from <b className={`text-${next}`}>{next}</b> — drift through the
      long corners and hit the boost pads.
    </p>
  );
}

/** Where this time sits between the three medal thresholds. */
function MedalLadder({ totalMs, medals }: { totalMs: number; medals: { gold: number; silver: number; bronze: number } }) {
  const lo = medals.gold * 0.92;
  const hi = medals.bronze * 1.12;
  const pos = (ms: number) => `${Math.min(100, Math.max(0, ((ms - lo) / (hi - lo)) * 100)).toFixed(1)}%`;
  const tier = totalMs <= medals.gold ? "gold" : totalMs <= medals.silver ? "silver" : totalMs <= medals.bronze ? "bronze" : "none";
  return (
    <div className={`ladder ladder-${tier}`}>
      <div className="ladder-track">
        <i style={{ width: pos(totalMs) }} />
        {(["gold", "silver", "bronze"] as const).map((m) => (
          <b key={m} className={`ladder-mark mark-${m}`} style={{ left: pos(medals[m]) }} title={`${m}: ${formatTime(medals[m])}`} />
        ))}
        <span className="ladder-you" style={{ left: pos(totalMs) }} />
      </div>
      <div className="ladder-labels">
        <span className="text-gold">Gold {formatTime(medals.gold)}</span>
        <span className="text-silver">Silver {formatTime(medals.silver)}</span>
        <span className="text-bronze">Bronze {formatTime(medals.bronze)}</span>
      </div>
    </div>
  );
}

/** Per-checkpoint gap to the opponent: green bars where you gained, red where you lost. */
function SectorBars({ mine, theirs, name }: { mine: number[]; theirs: number[]; name: string }) {
  const count = Math.min(mine.length, theirs.length);
  if (count === 0) return null;
  // Long tracks have a checkpoint every few seconds; show at most twelve sectors.
  const per = Math.ceil(count / 12);
  const n = Math.ceil(count / per);
  const sectors = Array.from({ length: n }, (_, i) => {
    const end = Math.min(count, (i + 1) * per) - 1;
    const start = i * per;
    const prevMine = start === 0 ? 0 : mine[start - 1];
    const prevTheirs = start === 0 ? 0 : theirs[start - 1];
    return mine[end] - prevMine - (theirs[end] - prevTheirs);
  });
  const max = Math.max(400, ...sectors.map((d) => Math.abs(d)));
  const gained = sectors.filter((d) => d < 0).length;
  return (
    <div className="sectors">
      <div className="sectors-head">
        <span className="eyebrow">Sectors vs {name}</span>
        <span className="muted small">
          faster in {gained} of {n}
        </span>
      </div>
      <div className="sector-list">
        {sectors.map((d, i) => (
          <div key={i} className={`sector ${d < 0 ? "ahead" : d > 0 ? "behind" : "even"}`} style={{ ["--i" as string]: i }}>
            <span className="sector-label">S{i + 1}</span>
            <span className="sector-bar">
              <i style={{ width: `${(Math.min(Math.abs(d), max) / max) * 50}%` }} />
            </span>
            <span className="sector-delta">{formatDelta(d)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
