import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { UnityStage } from "./components/UnityStage";
import type { RunResult } from "./lib/api";
import { prepareTelegram } from "./lib/telegram";
import { sendToUnity, type Loadout, type RaceFinished } from "./lib/unity";
import { Garage } from "./screens/Garage";
import { Home, tracks, type Track } from "./screens/Home";
import { Race } from "./screens/Race";
import { Ranks } from "./screens/Ranks";
import { Results } from "./screens/Results";
import { Vault } from "./screens/Vault";
import { useGame } from "./state/game";

type Screen = "home" | "race" | "results" | "garage" | "vault" | "ranks";

const ghostKey = (trackId: string) => `pv_ghost_${trackId}`;

function trackPayload(track: Track, loadout: Loadout) {
  let ghost = null;
  try {
    ghost = JSON.parse(localStorage.getItem(ghostKey(track.id)) || "null");
  } catch {
    ghost = null;
  }
  return {
    id: track.id,
    name: track.name,
    laps: track.laps,
    width: track.width,
    points: track.points,
    theme: track.theme,
    ghost,
    loadout,
  };
}

export default function App() {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const game = useGame();
  const [screen, setScreen] = useState<Screen>("home");
  const [trackId, setTrackId] = useState(tracks[0].id);
  const [unityReady, setUnityReady] = useState(false);
  const [finished, setFinished] = useState<RaceFinished | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];

  useEffect(prepareTelegram, []);

  // The menu shows the selected track behind the UI.
  useEffect(() => {
    if (unityReady && screen === "home") {
      sendToUnity("LoadTrack", trackPayload(track, game.loadout));
      sendToUnity("ShowMenu");
    }
    // Loadout changes are applied separately without rebuilding the track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unityReady, screen, trackId]);

  useEffect(() => {
    if (unityReady && screen !== "garage") sendToUnity("SetLoadout", game.loadout);
  }, [unityReady, game.loadout, screen]);

  const startRace = useCallback(() => {
    // Rebuilt at every start so the latest ghost and loadout are used.
    sendToUnity("LoadTrack", trackPayload(track, game.loadout));
    setScreen("race");
  }, [track, game.loadout]);

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
            localStorage.setItem(ghostKey(race.trackId), JSON.stringify(race.ghost));
          }
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
          {screen === "home" && <Home trackId={trackId} onSelect={setTrackId} onRace={startRace} />}
          {screen === "race" && <Race onFinish={onFinish} onQuit={goHome} />}
          {screen === "results" && finished && (
            <Results
              finished={finished}
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
