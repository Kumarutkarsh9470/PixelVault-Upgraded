import { MaterialChip, Sheet } from "../../components/ui";
import { formatDistance, type RunOutcome } from "../api";

export function ResultsScreen({
  outcome,
  error,
  onAgain,
  onForge,
  onMenu,
}: {
  outcome: RunOutcome | null;
  error: string | null;
  onAgain: () => void;
  onForge: () => void;
  onMenu: () => void;
}) {
  const earned = outcome ? Object.entries(outcome.reward) : [];

  return (
    <div className="screen results">
      <div className="spacer" />
      <Sheet title={outcome?.died === false ? "Run ended" : "Forge run over"}>
        {!outcome && !error && <p className="muted">Replaying your run on the server…</p>}
        {error && <p className="error">{error}</p>}
        {outcome && (
          <>
            <div className="finish-time">{formatDistance(outcome.distanceMm)}</div>
            {outcome.personalBest && <p className="good">New longest run!</p>}
            <p className="eyebrow">Runes kept</p>
            {earned.length > 0 ? (
              <div className="recipe">
                {earned.map(([id, n]) => (
                  <MaterialChip key={id} id={id} amount={n} />
                ))}
              </div>
            ) : (
              <p className="muted small">No runes this time.</p>
            )}
            {outcome.capped && <p className="muted small">You reached today's rune limit; runs still count for your best distance.</p>}
          </>
        )}
        <div className="actions">
          <button className="primary" onClick={onAgain}>
            Run again
          </button>
          <button onClick={onForge}>Forge</button>
          <button className="ghost" onClick={onMenu}>
            Menu
          </button>
        </div>
      </Sheet>
    </div>
  );
}
