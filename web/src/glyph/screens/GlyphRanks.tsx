import { useEffect, useState } from "react";

import { Nameplate } from "../../components/Nameplate";
import { Sheet } from "../../components/ui";
import { formatDistance, glyphApi, type GlyphEntry } from "../api";

export function GlyphRanks({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<GlyphEntry[] | null>(null);

  useEffect(() => {
    glyphApi
      .leaderboard()
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, []);

  return (
    <div className="screen ranks">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Longest runs</h2>
        <span />
      </header>
      <Sheet>
        {entries === null && <p className="muted">Loading…</p>}
        {entries?.length === 0 && <p className="muted">No runs yet. Be the first.</p>}
        <ol className="board">
          {entries?.map((e) => (
            <li key={e.rank}>
              <span className="rank">{e.rank}</span>
              <Nameplate name={e.name} frame={e.frame} />
              <span className="time">{formatDistance(e.distanceMm)}</span>
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}
