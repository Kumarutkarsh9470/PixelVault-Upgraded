import { useCallback, useEffect, useState } from "react";

import { formatTime } from "../lib/api";
import { haptic } from "../lib/telegram";
import { sendToUnity, useUnityEvent, type Hud, type RaceFinished } from "../lib/unity";

/** Countdown and HUD over the Unity canvas. Steering is read by Unity itself. */
export function Race({ onFinish, onQuit }: { onFinish: (result: RaceFinished) => void; onQuit: () => void }) {
  const [count, setCount] = useState<number | null>(3);
  const [hud, setHud] = useState<Hud | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    sendToUnity("ReadyRace");
    let n = 3;
    haptic("tap");
    const timer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        haptic("tap");
      } else {
        clearInterval(timer);
        setCount(0);
        haptic("success");
        sendToUnity("StartRace");
        setTimeout(() => setCount(null), 700);
      }
    }, 800);
    return () => clearInterval(timer);
  }, []);

  useUnityEvent<Hud>("hud", setHud);
  useUnityEvent(
    "lap",
    useCallback(() => {
      setFlash("Final lap");
      haptic("success");
      setTimeout(() => setFlash(null), 1400);
    }, []),
  );
  useUnityEvent(
    "respawn",
    useCallback(() => {
      setFlash("Back on track");
      setTimeout(() => setFlash(null), 1000);
    }, []),
  );
  useUnityEvent<RaceFinished>(
    "raceFinished",
    useCallback(
      (result) => {
        haptic("success");
        onFinish(result);
      },
      [onFinish],
    ),
  );

  return (
    <div className="screen race" >
      <div className="hud">
        <div className="hud-lap">
          LAP <b>{hud ? Math.min(hud.lap, hud.laps) : 1}</b>/{hud?.laps ?? 2}
        </div>
        <div className="hud-time">{formatTime(hud?.timeMs ?? 0)}</div>
        <div className="hud-speed">
          <b>{hud?.speedKmh ?? 0}</b> km/h
        </div>
      </div>

      {count !== null && <div className={`countdown ${count === 0 ? "go" : ""}`}>{count === 0 ? "GO" : count}</div>}
      {flash && <div className="flash">{flash}</div>}

      {count !== null && count > 0 && (
        <div className="touch-hint">
          <span>◀ Hold left</span>
          <span>Both to brake</span>
          <span>Hold right ▶</span>
        </div>
      )}

      <button className="quit" onClick={onQuit} aria-label="Quit race">
        ✕
      </button>
    </div>
  );
}
