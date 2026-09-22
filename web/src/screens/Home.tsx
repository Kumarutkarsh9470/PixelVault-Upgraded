import tracksData from "../data/tracks.json";
import { formatTime, formatUsdc } from "../lib/api";
import { catalog, useGame } from "../state/game";
import { MaterialChip, MedalBadge } from "../components/ui";

export const tracks = tracksData.tracks;
export type Track = (typeof tracks)[number];

export function medalFor(track: Track, ms: number | null | undefined) {
  if (ms == null) return null;
  if (ms <= track.medals.gold) return "gold" as const;
  if (ms <= track.medals.silver) return "silver" as const;
  if (ms <= track.medals.bronze) return "bronze" as const;
  return null;
}

export function Home({
  trackId,
  onSelect,
  onRace,
}: {
  trackId: string;
  onSelect: (id: string) => void;
  onRace: () => void;
}) {
  const { session, balances } = useGame();
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const best = session?.bests[track.id];
  const material = catalog.materials.find((m) => m.track === track.id)!;

  return (
    <div className="screen home">
      <header className="topbar">
        <div className="logo">
          PIXEL<span>VAULT</span>
        </div>
        <div className="wallet-pill">{formatUsdc(balances.usdc)}</div>
      </header>

      <div className="materials-row">
        {catalog.materials.map((m) => (
          <MaterialChip key={m.id} id={m.id} amount={session?.materials[m.id] ?? 0} />
        ))}
      </div>

      <div className="spacer" />

      <section className="track-panel">
        <div className="track-tabs">
          {tracks.map((t) => (
            <button key={t.id} className={t.id === track.id ? "active" : ""} onClick={() => onSelect(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <h1>{track.name}</h1>
        <p className="muted">{track.tagline}</p>

        <div className="targets">
          {(["gold", "silver", "bronze"] as const).map((m) => (
            <div key={m} className={`target target-${m}`}>
              <MedalBadge medal={m} size="sm" />
              <span>{formatTime(track.medals[m])}</span>
              <small>+{catalog.medalRewards[m]}</small>
            </div>
          ))}
        </div>

        <div className="best-row">
          <span className="muted">Your best</span>
          <strong>{formatTime(best)}</strong>
          <MedalBadge medal={medalFor(track, best)} size="sm" />
        </div>
        <p className="muted small">
          Medals here earn <b style={{ color: material.color }}>{material.name}</b>, used to craft cosmetics.
        </p>

        <button className="primary big" onClick={onRace}>
          Race
        </button>
      </section>
    </div>
  );
}
