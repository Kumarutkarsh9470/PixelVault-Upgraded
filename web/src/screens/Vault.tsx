import { useEffect, useMemo, useRef, useState } from "react";

import { api, formatUsdc, type Stats } from "../lib/api";
import { haptic } from "../lib/telegram";
import { allItems, gameName, refundOf, type Item } from "../state/catalog";
import { useWallet } from "../state/wallet";
import { isDeployed } from "../lib/program";
import { AnimatedNumber } from "../components/Fx";
import { BackingMeter, EmptyState, Sheet, Stat } from "../components/ui";
import { WalletPanel } from "../components/WalletPanel";


/** Everything the player owns, what it is worth, and the exits: redeem or move value to another game. */
export function Vault({ onBack }: { onBack: () => void }) {
  const { balances, owned, redeem, route, busy, error } = useWallet();
  const [routing, setRouting] = useState<Item | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const loaded = useRef(false);

  // Balances change after a redeem or route: fetch past the CDN cache so the totals move with them.
  useEffect(() => {
    api
      .stats(loaded.current)
      .then(setStats)
      .catch(() => setStats(null));
    loaded.current = true;
  }, [balances]);

  const holdings = useMemo(() => allItems.filter((i) => owned(i) > 0), [owned]);
  const refundable = holdings.reduce((sum, i) => sum + refundOf(i) * owned(i), 0);
  const destinations = allItems.filter((i) => routing && i.gameId !== routing.gameId && isDeployed(i.gameId, i.classId));

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
          <Stat label="Refundable value" value={<AnimatedNumber value={refundable} format={formatUsdc} />} accent />
          <Stat label="USDC" value={<AnimatedNumber value={balances.usdc} format={formatUsdc} />} />
        </div>
        <p className="muted small">
          Every item holds USDC in a program-owned vault. Redeem any time — even if the game shuts down.
        </p>

        {holdings.length === 0 && (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 5h16v14H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 12h3" />
              </svg>
            }
            title="Your vault is empty"
            hint="Win medals, craft an item in the Garage, and its USDC backing shows up here, redeemable any time."
          />
        )}

        <div className="item-list">
          {holdings.map((item) => (
            <div key={`${item.gameId}-${item.key}`} className={`item-card item-${item.type}`} data-tilt>
              <div className="item-head">
                <span
                  className={`swatch ${item.type === "chassis" ? "swatch-model" : item.type === "frame" ? "swatch-frame" : item.type === "aura" ? "swatch-aura" : "swatch-glow"}`}
                  style={item.type === "chassis" ? undefined : { background: item.type === "frame" || item.type === "aura" ? undefined : item.value, ["--c" as string]: item.value }}
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
              <BackingMeter price={item.price} backingBps={item.backingBps} count={owned(item)} />
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

        <WalletPanel />

        {stats && (
          <div className="transparency">
            <h3>
              <span className="live-dot" />
              Protocol, live from the chain
            </h3>
            <p className="muted small">Read straight from Solana devnet, not from our database.</p>
            <div className="stats">
              <Stat label="Total USDC backing" value={formatUsdc(stats.totalBacked)} />
              <Stat label="Vaults solvent" value={stats.solvent ? "Yes ✓" : "Check"} />
            </div>
            {stats.games.map((g) => (
              <div key={g.gameId} className="solvency">
                <div className="stat-line">
                  <span>{g.name}</span>
                  <span className="muted">
                    {g.crafted} crafted · {g.redeemed} redeemed · vault {formatUsdc(g.vaultBalance)}
                  </span>
                </div>
                <div className="solvency-bar" title="vault balance against what it owes">
                  <i style={{ width: `${Math.min(100, g.totalBacked > 0 ? (g.vaultBalance / g.totalBacked) * 100 : 100)}%` }} />
                  <b style={{ left: "100%" }} />
                </div>
                <small className="muted">
                  owes {formatUsdc(g.totalBacked)} · {g.vaultBalance >= g.totalBacked ? "fully covered" : "short"}
                </small>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
