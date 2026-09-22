import type { RunResult } from "../lib/api";
import { formatTime } from "../lib/api";
import type { RaceFinished } from "../lib/unity";
import { MaterialChip, MedalBadge, Sheet, Stat } from "../components/ui";
import { tracks } from "./Home";

export function Results({
  finished,
  result,
  error,
  onAgain,
  onGarage,
  onHome,
}: {
  finished: RaceFinished;
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
        <div className="result-time">{formatTime(finished.totalMs)}</div>

        {!result && !error && <p className="muted">Checking your run…</p>}
        {error && <p className="error">Couldn't save this run: {error}</p>}

        {result && (
          <>
            <div className="result-medal">
              <MedalBadge medal={result.medal} size="lg" />
              {result.personalBest && <span className="pb">New personal best</span>}
            </div>
            {!result.valid && <p className="error">Run rejected: {result.reason}</p>}

            <div className="stats">
              <Stat label="Best" value={formatTime(result.best)} />
              <Stat label="Rank" value={result.rank ? `#${result.rank}` : "—"} />
              <Stat label="Respawns" value={finished.respawns} />
            </div>

            {result.reward.amount > 0 ? (
              <div className="reward">
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
