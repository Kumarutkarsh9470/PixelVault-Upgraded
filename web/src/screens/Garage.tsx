import { useEffect, useMemo, useState } from "react";

import { formatUsdc } from "../lib/api";
import { haptic } from "../lib/telegram";
import { sendToUnity } from "../lib/unity";
import { allItems, useGame, type Item } from "../state/game";
import { MaterialChip, Sheet } from "../components/ui";

const TABS = [
  { type: "chassis", label: "Chassis" },
  { type: "underglow", label: "Underglow" },
  { type: "trail", label: "Trails" },
] as const;

type Slot = (typeof TABS)[number]["type"];

/** Browse cosmetics on your car in 3D, craft them, and equip what you own. */
export function Garage({ onBack }: { onBack: () => void }) {
  const { session, balances, loadout, owned, craft, equip, busy, error } = useGame();
  const [tab, setTab] = useState<Slot>("chassis");
  const [preview, setPreview] = useState<Item | null>(null);

  const items = useMemo(() => allItems.filter((i) => i.gameId === 1 && i.type === tab), [tab]);

  // Show the equipped loadout, with the previewed item swapped in.
  useEffect(() => {
    const shown = preview ? { ...loadout, [preview.type]: preview.value } : loadout;
    sendToUnity("ShowGarage", shown);
  }, [loadout, preview]);

  const materials = session?.materials ?? {};

  return (
    <div className="screen garage">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Garage</h2>
        <div className="wallet-pill">{formatUsdc(balances.usdc)}</div>
      </header>
      <div className="spacer" />

      <Sheet>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.type}
              className={t.type === tab ? "active" : ""}
              onClick={() => {
                setTab(t.type);
                setPreview(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "chassis" && (
          <button
            className={`item-row ${loadout.chassis === "race" && !preview ? "selected" : ""}`}
            onClick={() => {
              setPreview(null);
              equip(null, "chassis");
            }}
          >
            <span className="swatch swatch-model">STD</span>
            <span className="item-main">
              <b>Standard</b>
              <small className="muted">Free starter chassis</small>
            </span>
            <span className="tag">{loadout.chassis === "race" ? "Equipped" : "Equip"}</span>
          </button>
        )}

        <div className="item-list">
          {items.map((item) => {
            const count = owned(item);
            const equipped = loadout[item.type as Slot] === item.value && count > 0;
            const refund = Math.floor((item.price * item.backingBps) / 10_000);
            const recipe = Object.entries(item.recipe as Record<string, number>);
            const canCraft =
              recipe.every(([m, n]) => (materials[m] ?? 0) >= n) && balances.usdc >= item.price && !busy;
            const selected = preview?.key === item.key;

            return (
              <div key={item.key} className={`item-card ${selected ? "selected" : ""}`} onClick={() => setPreview(item)}>
                <div className="item-head">
                  <span
                    className={`swatch ${item.type === "chassis" ? "swatch-model" : ""}`}
                    style={item.type === "chassis" ? undefined : { background: item.value }}
                  >
                    {item.type === "chassis" ? item.name.slice(0, 3).toUpperCase() : ""}
                  </span>
                  <span className="item-main">
                    <b>
                      {item.name}
                      {item.maxSupply > 0 && <em className="limited">Limited · {item.maxSupply}</em>}
                    </b>
                    <small className="muted">
                      {formatUsdc(item.price)} · <span className="backed">{item.backingBps / 100}% refundable</span> ·{" "}
                      {formatUsdc(refund)} back anytime
                    </small>
                  </span>
                  {count > 0 && <span className="owned">×{count}</span>}
                </div>

                {selected && (
                  <div className="item-detail">
                    {recipe.length > 0 && (
                      <div className="recipe">
                        {recipe.map(([m, n]) => (
                          <MaterialChip key={m} id={m} amount={materials[m] ?? 0} need={n} />
                        ))}
                      </div>
                    )}
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
                        {busy?.startsWith("Crafting") ? "Crafting…" : `Craft · ${formatUsdc(item.price)}`}
                      </button>
                      {count > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            equip(equipped ? null : item, item.type as Slot);
                            setPreview(null);
                          }}
                        >
                          {equipped ? "Unequip" : "Equip"}
                        </button>
                      )}
                    </div>
                    {!canCraft && !busy && (
                      <p className="muted small">
                        {balances.usdc < item.price
                          ? "Not enough USDC."
                          : "Earn the missing materials with medals on the tracks."}
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
