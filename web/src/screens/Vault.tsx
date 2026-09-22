import { useEffect, useMemo, useState } from "react";

import { api, formatUsdc, type Stats } from "../lib/api";
import { haptic } from "../lib/telegram";
import { allItems, catalog, useGame, type Item } from "../state/game";
import { Sheet, Stat } from "../components/ui";

const refundOf = (item: Item) => Math.floor((item.price * item.backingBps) / 10_000);
const gameName = (gameId: number) => catalog.games.find((g) => g.gameId === gameId)?.name ?? `Game ${gameId}`;

/** Everything the player owns, what it is worth, and the exits: redeem or move value to another game. */
export function Vault({ onBack }: { onBack: () => void }) {
  const { balances, owned, redeem, route, busy, error } = useGame();
  const [routing, setRouting] = useState<Item | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, [balances]);

  const holdings = useMemo(() => allItems.filter((i) => owned(i) > 0), [owned]);
  const refundable = holdings.reduce((sum, i) => sum + refundOf(i) * owned(i), 0);
  const destinations = allItems.filter((i) => routing && i.gameId !== routing.gameId);

  const act = async (task: () => Promise<unknown>) => {
    try {
      await task();
      haptic("success");
      setRouting(null);
    } catch {
      haptic("error");
    }
  };

  return (
    <div className="screen vault">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>Vault</h2>
        <span />
      </header>

      <Sheet>
        <div className="stats">
          <Stat label="Refundable value" value={formatUsdc(refundable)} accent />
          <Stat label="USDC" value={formatUsdc(balances.usdc)} />
        </div>
        <p className="muted small">
          Every item holds USDC in a program-owned vault. Redeem any time — even if the game shuts down.
        </p>

        {holdings.length === 0 && <p className="muted">Nothing here yet. Earn materials and craft in the Garage.</p>}

        <div className="item-list">
          {holdings.map((item) => (
            <div key={`${item.gameId}-${item.key}`} className="item-card">
              <div className="item-head">
                <span
                  className={`swatch ${item.type === "chassis" ? "swatch-model" : ""}`}
                  style={item.type === "chassis" ? undefined : { background: item.value }}
                >
                  {item.type === "chassis" ? item.name.slice(0, 3).toUpperCase() : ""}
                </span>
                <span className="item-main">
                  <b>{item.name}</b>
                  <small className="muted">
                    {gameName(item.gameId)} · {formatUsdc(refundOf(item))} backing each
                  </small>
                </span>
                <span className="owned">×{owned(item)}</span>
              </div>
              <div className="actions">
                <button disabled={!!busy} onClick={() => act(() => redeem(item))}>
                  Redeem {formatUsdc(refundOf(item))}
                </button>
                <button className="ghost" disabled={!!busy} onClick={() => setRouting(routing?.key === item.key ? null : item)}>
                  Move to another game
                </button>
              </div>

              {routing?.key === item.key && (
                <div className="route">
                  <p className="muted small">
                    One transaction: this item's {formatUsdc(refundOf(item))} backing moves at par into the new item.
                    You pay only the difference.
                  </p>
                  {destinations.map((to) => {
                    const topUp = Math.max(0, to.price - refundOf(item));
                    return (
                      <button key={`${to.gameId}-${to.key}`} className="route-option" disabled={!!busy} onClick={() => act(() => route(item, to))}>
                        <span>
                          {gameName(to.gameId)} · <b>{to.name}</b>
                        </span>
                        <small>{topUp > 0 ? `+${formatUsdc(topUp)}` : "no top-up"}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {busy && <p className="muted">{busy}…</p>}
        {error && <p className="error">{error}</p>}

        {stats && (
          <div className="transparency">
            <h3>Protocol, live from the chain</h3>
            <div className="stats">
              <Stat label="Total USDC backing" value={formatUsdc(stats.totalBacked)} />
              <Stat label="Vaults solvent" value={stats.solvent ? "Yes ✓" : "Check"} />
            </div>
            {stats.games.map((g) => (
              <div key={g.gameId} className="stat-line">
                <span>{g.name}</span>
                <span className="muted">
                  {g.crafted} crafted · {g.redeemed} redeemed · vault {formatUsdc(g.vaultBalance)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
