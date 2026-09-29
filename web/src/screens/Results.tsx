import type { RunResult } from "../lib/api";
import { formatTime } from "../lib/api";
import { EXPLORER_SUFFIX, EXPLORER_TX } from "../config";
import { useGame } from "../state/game";
import type { VerifyProgress } from "../lib/verify";
import type { Opponent } from "../lib/opponents";
import type { RaceFinished } from "../lib/unity";
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
  const { verifying } = useGame();
  return (
    <div className="screen results">
      <Sheet>
        <p className="eyebrow">{track?.name}</p>
        <div className="result-time">{formatTime(result?.totalMs ?? finished.totalMs)}</div>
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

        {!result && !error && <Verifying progress={verifying} />}
        {error && <p className="error">Couldn't save this run: {error}</p>}

        {result && (
          <>
            <div className="result-medal">
              <MedalBadge medal={result.medal} size="lg" />
              {result.personalBest && <span className="pb">New personal best</span>}
            </div>
            {!result.valid && <p className="error">Run rejected: {result.reason}</p>}
            {result.valid && track && result.medal !== "gold" && <NextMedal totalMs={result.totalMs} medals={track.medals} />}
            {result.signature && (
              <a className="verified" href={`${EXPLORER_TX}${result.signature}${EXPLORER_SUFFIX}`} target="_blank" rel="noreferrer">
                Replayed and verified on Solana — check it yourself ↗
              </a>
            )}
            {!result.verified && (
              <p className="muted small">
                This run was not verified on-chain, so it earns no materials.{result.reason ? ` ${result.reason}.` : ""}
              </p>
            )}

            <div className="stats">
              <Stat label="Best" value={formatTime(result.best)} />
              <Stat label="Rank" value={result.rank ? `#${result.rank}` : "—"} />
              <Stat label="Verified" value={result.verified ? "on-chain ✓" : "pending"} />
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

/// The chain replaying a run takes a few seconds and several transactions, so
/// the player is told what is happening rather than watching a spinner.
function Verifying({ progress }: { progress: VerifyProgress | null }) {
  if (!progress) {
    return <p className="muted">Checking your run…</p>;
  }
  const percent = progress.totalSteps > 0 ? Math.round((progress.steps / progress.totalSteps) * 100) : 0;
  const label =
    progress.stage === "uploading"
      ? "Sending your inputs to Solana…"
      : progress.stage === "replaying"
        ? "Solana is re-driving your lap…"
        : "Recording the result…";
  return (
    <div className="verifying">
      <p className="muted">{label}</p>
      <div className="verify-bar">
        <span style={{ width: `${progress.stage === "replaying" ? percent : 100}%` }} />
      </div>
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
