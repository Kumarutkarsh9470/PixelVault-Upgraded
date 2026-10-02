import { useState } from "react";

import { formatUsdc } from "../lib/api";
import { chain } from "../lib/program";
import { haptic } from "../lib/telegram";
import { useWallet } from "../state/wallet";

/** Mirrors MIN_WITHDRAW in deploy/racer/api/sponsor.js. */
const MIN_WITHDRAW = 100_000;

/** Parses a dollar amount like "1.5" into USDC base units, or null. */
function parseUsdc(text: string): number | null {
  if (!/^\d*(\.\d{0,6})?$/.test(text.trim()) || text.trim() === "" || text.trim() === ".") return null;
  const [whole, fraction = ""] = text.trim().split(".");
  return Number(whole || "0") * 1_000_000 + Number(fraction.padEnd(6, "0"));
}

/** Getting USDC into the game wallet, and out to any Solana wallet. */
export function WalletPanel() {
  const { wallet, balances, withdraw, busy } = useWallet();
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!wallet) return null;

  const amount = parseUsdc(amountText);
  const problem =
    amount === null
      ? "Enter an amount"
      : amount < MIN_WITHDRAW
        ? `Minimum ${formatUsdc(MIN_WITHDRAW)}`
        : amount > balances.usdc
          ? "More than your balance"
          : to.trim() === ""
            ? "Enter a destination address"
            : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      haptic("success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (some Telegram clients): the address is selectable instead.
    }
  };

  const send = async () => {
    if (problem || amount === null) return;
    setResult(null);
    try {
      await withdraw(to, amount);
      haptic("success");
      setResult({ ok: true, text: `Sent ${formatUsdc(amount)}.` });
      setAmountText("");
    } catch (e) {
      haptic("error");
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="wallet-panel">
      <h3>Wallet</h3>
      <div className="actions">
        <button className={mode === "deposit" ? "selected" : ""} onClick={() => setMode(mode === "deposit" ? null : "deposit")}>
          Deposit
        </button>
        <button className={mode === "withdraw" ? "selected" : ""} onClick={() => setMode(mode === "withdraw" ? null : "withdraw")}>
          Withdraw
        </button>
      </div>

      {mode === "deposit" && (
        <div className="wallet-body">
          <p className="muted small">Send USDC on Solana to your game wallet:</p>
          <code className="address" onClick={copy}>
            {wallet}
          </code>
          <button className="ghost" onClick={copy}>
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          {chain.cluster !== "mainnet-beta" && (
            <p className="error">This is a {chain.cluster} test build. Do not send real USDC to this address.</p>
          )}
        </div>
      )}

      {mode === "withdraw" && (
        <div className="wallet-body">
          <p className="muted small">
            Send USDC to any Solana wallet or exchange deposit address. Fees are on us. Available: {formatUsdc(balances.usdc)}
          </p>
          <label className="field">
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Solana address" spellCheck={false} autoComplete="off" />
          </label>
          <label className="field">
            <span>Amount (USDC)</span>
            <div className="field-row">
              <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="0.00" />
              <button className="ghost" onClick={() => setAmountText((balances.usdc / 1_000_000).toString())}>
                Max
              </button>
            </div>
          </label>
          <button className="primary" disabled={!!problem || !!busy} onClick={send}>
            {problem ?? `Withdraw ${formatUsdc(amount!)}`}
          </button>
          {result && <p className={result.ok ? "good small" : "error"}>{result.text}</p>}
        </div>
      )}
    </div>
  );
}
