import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { Aurora, NavIcon, Particles, useTilt } from "../components/Fx";
import { UnityStage } from "../components/UnityStage";
import { demoMode } from "../lib/demo";
import { sfx, startMusic, unlockAudio } from "../lib/audio";
import { haptic, prepareTelegram } from "../lib/telegram";
import { Vault } from "../screens/Vault";
import { useWallet } from "../state/wallet";
import type { RunOutcome } from "./api";
import { glyphApi } from "./api";
import { Forge } from "./screens/Forge";
import { GlyphRanks } from "./screens/GlyphRanks";
import { Menu } from "./screens/Menu";
import { ResultsScreen } from "./screens/ResultsScreen";
import { RunScreen } from "./screens/RunScreen";
import { useGlyph } from "./state";
import { runner, type FinishedEvent } from "./unity";

type Screen = "menu" | "run" | "results" | "forge" | "vault" | "ranks";

const COUNTDOWN_FROM = 3;

export default function GlyphApp() {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const { wallet } = useWallet();
  const glyph = useGlyph();
  const [screen, setScreen] = useState<Screen>("menu");
  const [unityReady, setUnityReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);

  useEffect(prepareTelegram, []);
  useTilt();

  useEffect(() => {
    const start = () => {
      unlockAudio();
      startMusic();
      window.removeEventListener("pointerdown", start);
    };
    window.addEventListener("pointerdown", start);
    return () => window.removeEventListener("pointerdown", start);
  }, []);

  // Behind every screen but the run, the runner plays itself wearing your cosmetics.
  useEffect(() => {
    if (unityReady && screen !== "run") runner.send("ShowMenu", glyph.cosmetics);
  }, [unityReady, screen, glyph.cosmetics]);

  const startRun = useCallback(async () => {
    if (!wallet && !demoMode) return;
    setOutcome(null);
    setRunError(null);
    try {
      const { runId: id, seed } = demoMode
        ? { runId: "demo", seed: Math.floor(Math.random() * 2 ** 32) }
        : await glyphApi.start(wallet!);
      runId.current = id;
      runner.send("StartRun", { seed: String(seed), cosmetics: glyph.cosmetics });
      setScreen("run");
      setCountdown(COUNTDOWN_FROM);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setScreen("results");
    }
  }, [wallet, glyph.cosmetics]);

  useEffect(() => {
    if (countdown <= 0) return;
    sfx.countdown();
    const timer = setTimeout(() => {
      if (countdown === 1) {
        runner.send("Go");
        sfx.go();
      }
      setCountdown(countdown - 1);
    }, 700);
    return () => clearTimeout(timer);
  }, [countdown]);

  runner.useEvent<FinishedEvent>(
    "finished",
    useCallback(
      (run: FinishedEvent) => {
        const id = runId.current;
        runId.current = null;
        if (!id) return;
        if (run.died) {
          sfx.impact(1);
          haptic("heavy");
        }
        setScreen("results");
        glyph
          .submit(id, run)
          .then((o) => {
            setOutcome(o);
            if (Object.keys(o.reward).length > 0) sfx.reward();
          })
          .catch((e) => setRunError(e.message));
      },
      [glyph],
    ),
  );

  const onUnityReady = useCallback(() => setUnityReady(true), []);
  const goMenu = useCallback(() => setScreen("menu"), []);

  return (
    <div className={`app glyph ${demoMode ? "demo" : ""} screen-${screen === "run" ? "race" : screen}`}>
      <UnityStage onReady={onUnityReady} load={runner.load} />
      <Aurora />
      {screen !== "run" && <Particles />}

      {demoMode && unityReady && (
        <div className="demo-banner">
          <span className="demo-dot" />
          <span>
            <b>Showcase mode.</b> <span className="demo-long">Runs and forging use a demo wallet. Open it in Telegram to play for real USDC.</span><span className="demo-short">Demo wallet.</span>
          </span>
          <a href="https://t.me/pixelvault_racer_bot/race" target="_blank" rel="noreferrer">
            Open in Telegram
          </a>
        </div>
      )}

      {!demoMode && privyReady && !authenticated && (
        <div className="gate">
          <div className="gate-card">
            <div className="logo big">
              GLYPH<span>FORGE</span>
            </div>
            <p>Run the forge, gather runes, and forge cosmetics you can always cash back out.</p>
            <button className="primary big" onClick={login}>
              Sign in
            </button>
          </div>
        </div>
      )}

      {!demoMode && authenticated && !glyph.ready && unityReady && (
        <div className="gate">
          <p className="muted">{glyph.error ?? "Lighting the forge…"}</p>
        </div>
      )}

      {glyph.ready && (
        <>
          {screen === "menu" && <Menu onRun={startRun} />}
          {screen === "run" && <RunScreen countdown={countdown} onQuit={() => runner.send("EndRun")} />}
          {screen === "results" && (
            <ResultsScreen outcome={outcome} error={runError} onAgain={startRun} onForge={() => setScreen("forge")} onMenu={goMenu} />
          )}
          {screen === "forge" && <Forge onBack={goMenu} />}
          {screen === "vault" && <Vault onBack={goMenu} />}
          {screen === "ranks" && <GlyphRanks onBack={goMenu} />}

          {screen === "menu" && (
            <nav className="bottom-nav">
              <button className="active">
                <NavIcon kind="run" />
                Run
              </button>
              <button onClick={() => setScreen("forge")}>
                <NavIcon kind="forge" />
                Forge
              </button>
              <button onClick={() => setScreen("vault")}>
                <NavIcon kind="vault" />
                Vault
              </button>
              <button onClick={() => setScreen("ranks")}>
                <NavIcon kind="ranks" />
                Ranks
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
