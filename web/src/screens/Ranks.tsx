import { useEffect, useState } from "react";

import { api, formatTime, type LeaderboardEntry } from "../lib/api";
import { Nameplate } from "../components/Nameplate";
import { Sheet } from "../components/ui";
import { tracks } from "./Home";

export function Ranks({ onBack }: { onBack: () => void }) {
  const [trackId, setTrackId] = useState(tracks[0].id);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    setEntries(null);
    api
      .leaderboard(trackId)
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, [trackId]);

  return (
    <div className="screen ranks">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Leaderboard</h2>
        <span />
      </header>
      <Sheet>
        <div className="tabs">
          {tracks.map((t) => (
            <button key={t.id} className={t.id === trackId ? "active" : ""} onClick={() => setTrackId(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        {entries === null && <p className="muted">Loading…</p>}
        {entries?.length === 0 && <p className="muted">No times yet. Be the first.</p>}
        <ol className="board">
          {entries?.map((e) => (
            <li key={e.rank}>
              <span className="rank">{e.rank}</span>
              <Nameplate name={e.name} frame={e.frame} />
              <span className="time">{formatTime(e.totalMs)}</span>
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}
