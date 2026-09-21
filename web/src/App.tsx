import { useEffect, useState } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";

import { SOLANA_CHAIN } from "./config";
import { fetchSolBalance, submitSponsoredMemo } from "./sponsor";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        platform?: string;
        initData?: string;
        initDataUnsafe?: { user?: { username?: string } };
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

const telegram = window.Telegram?.WebApp;
const inTelegram = !!telegram?.platform && telegram.platform !== "unknown";
// Privy validates this signed launch data against the bot token set in its
// dashboard; if it is missing, seamless login cannot work at all.
const launchDataLength = telegram?.initData?.length ?? 0;
const launchUser = telegram?.initDataUnsafe?.user?.username;

export default function App() {
  const { ready, authenticated, user, logout } = usePrivy();
  // The Privy modal only says "Something went wrong"; the callback carries the code.
  const { login } = useLogin({
    onError: (error) => setStatus("Login error: " + String(error)),
  });
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const wallet = wallets[0];
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    telegram?.ready?.();
    telegram?.expand?.();
  }, []);

  useEffect(() => {
    if (!wallet) {
      return;
    }
    fetchSolBalance(wallet.address)
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [wallet?.address, signature]);

  async function sendSponsored() {
    if (!wallet) {
      return;
    }
    setBusy(true);
    setSignature(null);
    try {
      setStatus("Building transaction…");
      const sig = await submitSponsoredMemo(wallet.address, async (unsigned) => {
        setStatus("Signing with your embedded wallet…");
        const { signedTransaction } = await signTransaction({
          transaction: unsigned,
          wallet,
          chain: SOLANA_CHAIN,
        });
        setStatus("Sponsor is co-signing and submitting…");
        return signedTransaction;
      });
      setSignature(sig);
      setStatus("Confirmed on devnet. You paid no fees.");
    } catch (e) {
      setStatus("Failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const telegramName = user?.telegram?.username ? "@" + user.telegram.username : null;

  return (
    <main>
      <h1>PixelVault Wallet</h1>
      <p className="muted">Wallet spike · devnet</p>

      <section className="card">
        <Row label="Environment" value={inTelegram ? `Telegram ${telegram?.platform}` : "Browser"} />
        <Row label="Domain" value={window.location.host} mono />
        <Row
          label="Launch data"
          value={launchDataLength ? `${launchDataLength} chars${launchUser ? " · @" + launchUser : ""}` : "none"}
        />
        <Row label="Privy" value={ready ? "Ready" : "Loading…"} />
        <Row label="Signed in" value={authenticated ? telegramName ?? user?.email?.address ?? "Yes" : "No"} />
        {wallet && <Row label="Wallet" value={short(wallet.address)} mono />}
        {wallet && <Row label="SOL balance" value={balance === null ? "…" : balance.toFixed(4)} />}
      </section>

      {!ready ? null : !authenticated ? (
        <button onClick={login}>Sign in</button>
      ) : !wallet ? (
        <p className="muted">Creating your wallet…</p>
      ) : (
        <button onClick={sendSponsored} disabled={busy}>
          {busy ? "Working…" : "Sign a sponsored transaction"}
        </button>
      )}

      {status && <p className="status">{status}</p>}
      {signature && (
        <a
          className="explorer"
          href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          View on Solana Explorer
        </a>
      )}

      {authenticated && (
        <button className="secondary" onClick={logout}>
          Sign out
        </button>
      )}
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  );
}

function short(value: string) {
  return value.slice(0, 4) + "…" + value.slice(-4);
}
