import { formatUsdc } from "../../lib/api";
import { MaterialChip } from "../../components/ui";
import { catalog } from "../../state/catalog";
import { useWallet } from "../../state/wallet";
import { formatDistance } from "../api";
import { useGlyph } from "../state";

const RUNES = catalog.materials.filter((m) => "game" in m && m.game === "glyph-forge");

export function Menu({ onRun }: { onRun: () => void }) {
  const { session } = useGlyph();
  const { balances } = useWallet();

  return (
    <div className="screen home glyph-home">
      <header className="topbar">
        <a className="icon-button back-to-hub" href="/" aria-label="Back to Neon Racer">
          ←
        </a>
        <div className="logo">
          GLYPH<span>FORGE</span>
        </div>
        <div className="wallet-pill">{formatUsdc(balances.usdc)}</div>
      </header>

      <div className="materials-row">
        {RUNES.map((m) => (
          <MaterialChip key={m.id} id={m.id} amount={session?.materials[m.id] ?? 0} />
        ))}
      </div>

      <div className="spacer" />

      <section className="track-panel">
        <h1>The Forge Run</h1>
        <p className="muted">Three lanes, endless and ever faster. Swipe to dodge, jump and slide; gather runes to forge with.</p>

        <div className="best-row">
          <span className="muted">Your longest run</span>
          <strong>{formatDistance(session?.player.bestMm ?? 0)}</strong>
        </div>
        <p className="muted small">
          Every run is replayed on our server from your inputs, so the runes you keep are exactly the ones you reached.
        </p>

        <button className="primary big" onClick={onRun}>
          Run
        </button>
      </section>
    </div>
  );
}
