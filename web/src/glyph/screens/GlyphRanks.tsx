import { useEffect, useState } from "react";

import { Nameplate } from "../../components/Nameplate";
import { Podium, Sheet, Skeleton } from "../../components/ui";
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
        {entries === null && <Skeleton rows={6} />}
        {entries?.length === 0 && <p className="muted">No runs yet. Be the first.</p>}
        {entries && entries.length > 0 && (
          <>
            <Podium
              entries={entries.slice(0, 3).map((e) => ({ name: e.name, frame: e.frame, value: formatDistance(e.distanceMm) }))}
              render={(e) => <Nameplate name={e.name} frame={e.frame} />}
            />
            <ol className="board" start={4}>
              {entries.slice(3).map((e) => (
                <li key={e.rank} style={{ ["--i" as string]: e.rank }}>
                  <span className="rank">{e.rank}</span>
                  <Nameplate name={e.name} frame={e.frame} />
                  <span className="time">{formatDistance(e.distanceMm)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Sheet>
    </div>
  );
}
