import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { UnityStage } from "./components/UnityStage";
import type { RunResult } from "./lib/api";
import { applySettings, sfx, startMusic, unlockAudio } from "./lib/audio";
import { leader, nova, personalBest, savePersonalBest, type Opponent, type OpponentKind } from "./lib/opponents";
import { settings, useSettings } from "./lib/settings";
import { prepareTelegram } from "./lib/telegram";
import { requestTilt, setSteering } from "./lib/tilt";
import { sendToUnity, useUnityEvent, type Loadout, type RaceFinished } from "./lib/unity";
import { Garage } from "./screens/Garage";
import { Home, tracks, type Track } from "./screens/Home";
import { Race } from "./screens/Race";
import { Ranks } from "./screens/Ranks";
import { Results } from "./screens/Results";
import { Settings } from "./screens/Settings";
import { Vault } from "./screens/Vault";
import { useGame } from "./state/game";

type Screen = "home" | "race" | "results" | "garage" | "vault" | "ranks" | "settings";

const OPPONENT_KEY = "pv_opponent";

function savedOpponentKind(): OpponentKind {
  try {
    const v = localStorage.getItem(OPPONENT_KEY);
    return v === "leader" || v === "best" || v === "none" ? v : "nova";
  } catch {
    return "nova";
  }
}

function trackPayload(track: Track, loadout: Loadout, opponent: Opponent | null) {
  return {
    id: track.id,
    name: track.name,
    laps: track.laps,
    width: track.width,
    points: track.points,
    theme: track.theme,
    ghost: opponent?.ghost ?? null,
    loadout,
  };
}

export default function App() {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const game = useGame();
  const prefs = useSettings();
  const [screen, setScreen] = useState<Screen>("home");
  const [trackId, setTrackId] = useState(tracks[0].id);
  const [unityReady, setUnityReady] = useState(false);
  const [finished, setFinished] = useState<RaceFinished | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [opponentKind, setOpponentKindState] = useState<OpponentKind>(savedOpponentKind);
  const [leaderOpponent, setLeaderOpponent] = useState<Opponent | null>(null);
  const [raceOpponent, setRaceOpponent] = useState<Opponent | null>(null);
  const [previousBest, setPreviousBest] = useState<number | null>(null);

  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];

  useEffect(prepareTelegram, []);

  // Audio can only start from a gesture: the first tap anywhere starts the soundtrack.
  useEffect(() => {
    const start = () => {
      unlockAudio();
      startMusic();
      window.removeEventListener("pointerdown", start);
    };
    window.addEventListener("pointerdown", start);
    return () => window.removeEventListener("pointerdown", start);
  }, []);

  useEffect(() => {
    let live = true;
    setLeaderOpponent(null);
    leader(track.id).then((l) => live && setLeaderOpponent(l));
    return () => {
      live = false;
    };
  }, [track.id]);

  const opponents: Record<Exclude<OpponentKind, "none">, Opponent | null> = {
    nova: nova(track.id),
    leader: leaderOpponent,
    best: personalBest(track.id),
  };
  const opponent = opponentKind === "none" ? null : (opponents[opponentKind] ?? opponents.nova);

  const setOpponentKind = useCallback((kind: OpponentKind) => {
    setOpponentKindState(kind);
    try {
      localStorage.setItem(OPPONENT_KEY, kind);
    } catch {
      // Not remembered across sessions; the choice still applies now.
    }
  }, []);

  // Preferences Unity needs: steering mode and glow effects.
  useEffect(() => {
    if (!unityReady) return;
    setSteering(prefs.steering);
    sendToUnity("SetBloom", prefs.effects ? "1" : "0");
    applySettings();
  }, [unityReady, prefs.steering, prefs.effects]);

  // Unity drops the glow on phones that cannot hold the frame rate; remember that.
  useUnityEvent<{ bloom: boolean }>(
    "quality",
    useCallback((q: { bloom: boolean }) => {
      if (!q.bloom) settings.set({ effects: false });
    }, []),
  );

  // The menu shows the selected track behind the UI.
  useEffect(() => {
    if (unityReady && screen === "home") {
      sendToUnity("LoadTrack", trackPayload(track, game.loadout, null));
      sendToUnity("ShowMenu");
    }
    // Loadout changes are applied separately without rebuilding the track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unityReady, screen, trackId]);

  useEffect(() => {
    if (unityReady && screen !== "garage") sendToUnity("SetLoadout", game.loadout);
  }, [unityReady, game.loadout, screen]);

  const startRace = useCallback(() => {
    unlockAudio();
    sfx.click();
    // iOS only grants motion access from a tap, so ask again on the Race tap.
    if (settings.get().steering === "tilt") {
      void requestTilt().then((ok) => setSteering(ok ? "tilt" : "touch"));
    }
    // Rebuilt at every start so the chosen ghost and latest loadout are used.
    sendToUnity("LoadTrack", trackPayload(track, game.loadout, opponent));
    setRaceOpponent(opponent);
    setPreviousBest(game.session?.bests[track.id] ?? null);
    setScreen("race");
  }, [track, game.loadout, game.session, opponent]);

  const onFinish = useCallback(
    (race: RaceFinished) => {
      setFinished(race);
      setResult(null);
      setResultError(null);
      setScreen("results");
      game
        .submitRun(race)
        .then((r) => {
          setResult(r);
          if (r.valid && r.personalBest) {
            savePersonalBest(race.trackId, { totalMs: race.totalMs, splits: race.splits, ghost: race.ghost });
            void leader(race.trackId, true).then((l) => setLeaderOpponent(l));
          }
          if (r.reward.amount > 0) sfx.reward();
        })
        .catch((e) => setResultError(e.message));
    },
    [game],
  );

  const onUnityReady = useCallback(() => setUnityReady(true), []);
  const goHome = useCallback(() => setScreen("home"), []);

  return (
    <div className="app">
      <UnityStage onReady={onUnityReady} />

      {privyReady && !authenticated && (
        <div className="gate">
          <div className="gate-card">
            <div className="logo big">
              PIXEL<span>VAULT</span>
            </div>
            <p>Race, earn materials, and craft cosmetics you can always cash back out.</p>
            <button className="primary big" onClick={login}>
              Sign in
            </button>
          </div>
        </div>
      )}

      {authenticated && !game.ready && unityReady && (
        <div className="gate">
          <p className="muted">{game.error ?? "Setting up your garage…"}</p>
        </div>
      )}

      {game.ready && (
        <>
          {screen === "home" && (
            <Home
              trackId={trackId}
              onSelect={setTrackId}
              onRace={startRace}
              opponentKind={opponentKind}
              opponents={opponents}
              onOpponent={setOpponentKind}
              onSettings={() => setScreen("settings")}
            />
          )}
          {screen === "race" && <Race track={track} opponent={raceOpponent} onFinish={onFinish} onQuit={goHome} />}
          {screen === "results" && finished && (
            <Results
              finished={finished}
              opponent={raceOpponent}
              previousBest={previousBest}
              result={result}
              error={resultError}
              onAgain={startRace}
              onGarage={() => setScreen("garage")}
              onHome={goHome}
            />
          )}
          {screen === "garage" && <Garage onBack={goHome} />}
          {screen === "vault" && <Vault onBack={goHome} />}
          {screen === "ranks" && <Ranks onBack={goHome} />}
          {screen === "settings" && <Settings onClose={goHome} />}

          {screen === "home" && (
            <nav className="bottom-nav">
              <button className="active">Race</button>
              <button onClick={() => setScreen("garage")}>Garage</button>
              <button onClick={() => setScreen("vault")}>Vault</button>
              <button onClick={() => setScreen("ranks")}>Ranks</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
