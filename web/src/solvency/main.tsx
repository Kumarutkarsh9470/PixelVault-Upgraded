// The public solvency page: every vault, what it owes, whether it is covered.
// What each game owes comes from the program's own accounting (read by the
// API); each vault's balance is read again here, in the browser, straight
// from Solana, so the two can be compared by anyone.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { address, createSolanaRpc } from "@solana/kit";

import chain from "../data/chain.json";
import { formatUsdc, type Stats } from "../lib/api";
import "../styles.css";
import "../fx.css";
import "../screens.css";
import "./solvency.css";

const rpc = createSolanaRpc(chain.rpc);
const EXPLORER = `https://explorer.solana.com/address/`;
const SUFFIX = chain.cluster === "mainnet-beta" ? "" : `?cluster=${chain.cluster}`;

type VaultRead = { gameId: number; vault: string; balance: number | null };

async function readVaults(): Promise<VaultRead[]> {
  const games = Object.entries(chain.games) as [string, { vault: string }][];
  return Promise.all(
    games.map(async ([gameId, g]) => {
      try {
        const { value } = await rpc.getTokenAccountBalance(address(g.vault)).send();
        return { gameId: Number(gameId), vault: g.vault, balance: Number(value.amount) };
      } catch {
        return { gameId: Number(gameId), vault: g.vault, balance: null };
      }
    }),
  );
}

function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [vaults, setVaults] = useState<VaultRead[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [s, v] = await Promise.all([fetch(`/api/stats?t=${Date.now()}`).then((r) => r.json()), readVaults()]);
        if (!live) return;
        setStats(s);
        setVaults(v);
        setUpdated(new Date());
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const covered = stats ? stats.games.every((g) => (vaults.find((v) => v.gameId === g.gameId)?.balance ?? g.vaultBalance) >= g.totalBacked) : null;

  return (
    <main className="solvency-page">
      <header className="solvency-head">
        <div className="logo">
          PIXEL<span>VAULT</span>
        </div>
        <h1>Solvency, live</h1>
        <p className="muted">
          Every item holds USDC in a vault owned by the program. This page compares what each vault holds with what it owes. The
          balances are read from Solana by your browser; the obligations are the program's own accounting.
        </p>
        {covered !== null && (
          <div className={`solvency-verdict ${covered ? "ok" : "bad"}`}>
            <span className="live-dot" />
            {covered ? "Every vault covers what it owes" : "A vault is short: check below"}
          </div>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {!stats && !error && <p className="muted">Reading the chain…</p>}

      {stats && (
        <>
          <section className="stats">
            <div className="stat stat-accent">
              <span>Total USDC backing owed</span>
              <strong>{formatUsdc(stats.totalBacked)}</strong>
            </div>
            <div className="stat">
              <span>Games</span>
              <strong>{stats.games.length}</strong>
            </div>
            <div className="stat">
              <span>Items crafted · redeemed</span>
              <strong>
                {stats.games.reduce((n, g) => n + g.crafted, 0)} · {stats.games.reduce((n, g) => n + g.redeemed, 0)}
              </strong>
            </div>
          </section>

          {stats.games.map((g) => {
            const read = vaults.find((v) => v.gameId === g.gameId);
            const balance = read?.balance ?? g.vaultBalance;
            const ratio = g.totalBacked > 0 ? balance / g.totalBacked : 1;
            return (
              <section key={g.gameId} className="solvency-game sheet">
                <div className="solvency-game-head">
                  <h2>{g.name}</h2>
                  <span className={`badge ${balance >= g.totalBacked ? "ok" : "bad"}`}>
                    {balance >= g.totalBacked ? "covered" : "short"} · {(ratio * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="solvency-bar big">
                  <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  <b style={{ left: "100%" }} />
                </div>
                <div className="stats">
                  <div className="stat">
                    <span>Vault holds (read in your browser)</span>
                    <strong>{read?.balance == null ? "…" : formatUsdc(read.balance)}</strong>
                  </div>
                  <div className="stat">
                    <span>Owed to item holders</span>
                    <strong>{formatUsdc(g.totalBacked)}</strong>
                  </div>
                  <div className="stat">
                    <span>Crafted · redeemed</span>
                    <strong>
                      {g.crafted} · {g.redeemed}
                    </strong>
                  </div>
                </div>
                <table className="solvency-table">
                  <thead>
                    <tr>
                      <th>Item class</th>
                      <th>In circulation</th>
                      <th>Backing each</th>
                      <th>Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.classes
                      .filter((c) => c.gameId === g.gameId)
                      .map((c) => (
                        <tr key={c.classId}>
                          <td>#{c.classId}</td>
                          <td>{c.backedSupply}</td>
                          <td>{formatUsdc(c.backingPerUnit)}</td>
                          <td>{formatUsdc(c.backedSupply * c.backingPerUnit)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="muted small">
                  Vault{" "}
                  <a href={`${EXPLORER}${read?.vault ?? ""}${SUFFIX}`} target="_blank" rel="noreferrer">
                    {read?.vault}
                  </a>{" "}
                  · owned by the game's program address; only <code>redeem</code> can move USDC out of it.
                </p>
              </section>
            );
          })}

          <footer className="muted small">
            Program{" "}
            <a href={`${EXPLORER}${chain.programId}${SUFFIX}`} target="_blank" rel="noreferrer">
              {chain.programId}
            </a>{" "}
            on {chain.cluster}. {updated && `Updated ${updated.toLocaleTimeString()}; refreshes every 30 s.`}{" "}
            <a href="/">Play</a> · <a href="https://github.com/Kumarutkarsh9470/PixelVault-Upgraded">Source and tests</a>
          </footer>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
