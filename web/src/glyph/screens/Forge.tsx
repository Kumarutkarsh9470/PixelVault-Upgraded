import { useMemo, useState } from "react";

import { formatUsdc } from "../../lib/api";
import { isDeployed } from "../../lib/program";
import { haptic } from "../../lib/telegram";
import { MaterialChip, Sheet } from "../../components/ui";
import { allItems, refundOf } from "../../state/catalog";
import { useWallet } from "../../state/wallet";
import { GLYPH_GAME_ID, useGlyph } from "../state";

const TABS = [
  { type: "frame", label: "Frames" },
  { type: "aura", label: "Auras" },
] as const;

type Slot = (typeof TABS)[number]["type"];

/** Forge frames and auras from runes plus USDC; equip what you own. Frames also show on both games' leaderboards. */
export function Forge({ onBack }: { onBack: () => void }) {
  const { session, loadout, equip } = useGlyph();
  const { balances, owned, craft, busy, error } = useWallet();
  const [tab, setTab] = useState<Slot>("frame");
  const [open, setOpen] = useState<string | null>(null);
  const items = useMemo(() => allItems.filter((i) => i.gameId === GLYPH_GAME_ID && i.type === tab), [tab]);
  const runes = session?.materials ?? {};

  return (
    <div className="screen garage">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Forge</h2>
        <div className="wallet-pill">{formatUsdc(balances.usdc)}</div>
      </header>
      <div className="spacer" />

      <Sheet>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.type} className={t.type === tab ? "active" : ""} onClick={() => setTab(t.type)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {tab === "frame"
            ? "Your frame glows on your runner and borders your name on the Glyph Forge and Neon Racer leaderboards."
            : "An aura of rune-light around your runner."}
        </p>

        <div className="item-list">
          {items.map((item) => {
            const count = owned(item);
            const live = isDeployed(item.gameId, item.classId);
            const equipped = loadout[tab] === item.key && count > 0;
            const recipe = Object.entries(item.recipe as Record<string, number>);
            const canCraft = live && recipe.every(([m, n]) => (runes[m] ?? 0) >= n) && balances.usdc >= item.price && !busy;

            return (
              <div key={item.key} className={`item-card ${open === item.key ? "selected" : ""}`} onClick={() => setOpen(item.key)}>
                <div className="item-head">
                  <span className={`swatch swatch-${tab}`} style={{ ["--c" as string]: item.value }} />
                  <span className="item-main">
                    <b>
                      {item.name}
                      {item.maxSupply > 0 && <em className="limited">Limited · {item.maxSupply}</em>}
                    </b>
                    <small className="muted">
                      {formatUsdc(item.price)} · <span className="backed">{item.backingBps / 100}% refundable</span> ·{" "}
                      {formatUsdc(refundOf(item))} back anytime
                    </small>
                  </span>
                  {count > 0 && <span className="owned">×{count}</span>}
                </div>

                {open === item.key && (
                  <div className="item-detail">
                    <div className="recipe">
                      {recipe.map(([m, n]) => (
                        <MaterialChip key={m} id={m} amount={runes[m] ?? 0} need={n} />
                      ))}
                    </div>
                    <div className="actions">
                      <button
                        className="primary"
                        disabled={!canCraft}
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await craft(item);
                            haptic("success");
                          } catch {
                            haptic("error");
                          }
                        }}
                      >
                        {busy?.startsWith("Crafting") ? "Forging…" : `Forge · ${formatUsdc(item.price)}`}
                      </button>
                      {count > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            equip(equipped ? null : item, tab);
                          }}
                        >
                          {equipped ? "Unequip" : "Equip"}
                        </button>
                      )}
                    </div>
                    {!canCraft && !busy && (
                      <p className="muted small">
                        {!live
                          ? "Coming soon: not yet created on-chain."
                          : balances.usdc < item.price
                            ? "Not enough USDC."
                            : "Gather the missing runes on the Forge Run."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="error">{error}</p>}
      </Sheet>
    </div>
  );
}
