import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Confetti } from "../components/Fx";
import { formatTime } from "../lib/api";
import { setEngine, sfx, startEngine, stopEngine } from "../lib/audio";
import type { Opponent } from "../lib/opponents";
import { useSettings } from "../lib/settings";
import { haptic } from "../lib/telegram";
import { trackShape } from "../lib/trackShape";
import { sendToUnity, useUnityEvent, type CheckpointEvent, type Hud, type RaceFinished } from "../lib/unity";
import type { Track } from "./Home";

const LIGHT_MS = 650;
const TOP_KMH = 230;

export function formatDelta(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}`;
}

/**
 * Start lights, HUD and finish over the Unity canvas. Steering is read by
 * Unity itself; this layer only shows state and plays sound.
 */
export function Race({
  track,
  opponent,
  onFinish,
  onQuit,
}: {
  track: Track;
  opponent: Opponent | null;
  onFinish: (result: RaceFinished) => void;
  onQuit: () => void;
}) {
  const { steering } = useSettings();
  const [lights, setLights] = useState(0);
  const [go, setGo] = useState<boolean | null>(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [finish, setFinish] = useState<{ totalMs: number; delta: number | null } | null>(null);
  const splitIndex = useRef(0);
  const flashTimer = useRef<number>(0);

  const showFlash = useCallback((text: string, ms = 1200) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  }, []);

  // F1-style start: five reds light one by one, a short random hold, then lights out.
  useEffect(() => {
    sendToUnity("ReadyRace");
    startEngine();
    const timers: number[] = [];
    for (let i = 1; i <= 5; i++) {
      timers.push(
        window.setTimeout(() => {
          setLights(i);
          sfx.countdown();
          haptic("tap");
        }, i * LIGHT_MS),
      );
    }
    const hold = 5 * LIGHT_MS + 300 + Math.random() * 500;
    timers.push(
      window.setTimeout(() => {
        setLights(0);
        setGo(true);
        sfx.go();
        haptic("success");
        sendToUnity("StartRace");
      }, hold),
    );
    timers.push(window.setTimeout(() => setGo(null), hold + 900));
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(flashTimer.current);
      stopEngine();
    };
  }, []);

  useUnityEvent<Hud>(
    "hud",
    useCallback((h: Hud) => {
      setHud(h);
      setEngine(h.speedKmh, h.boost, h.drift);
    }, []),
  );

  const onSplit = useCallback(
    (e: CheckpointEvent, isLap: boolean) => {
      const i = splitIndex.current++;
      const target = opponent?.splits[i];
      if (target != null) {
        const d = e.timeMs - target;
        setDelta(d);
        if (!isLap) sfx.checkpoint(d < 0);
      }
      if (isLap && hud && e.lap < hud.laps) {
        sfx.lap();
        haptic("success");
        showFlash(e.lap === hud.laps - 1 ? "Final lap" : `Lap ${e.lap + 1}`, 1400);
      }
    },
    [opponent, hud, showFlash],
  );
  useUnityEvent<CheckpointEvent>("checkpoint", useCallback((e) => onSplit(e, false), [onSplit]));
  useUnityEvent<CheckpointEvent>("lap", useCallback((e) => onSplit(e, true), [onSplit]));

  useUnityEvent(
    "respawn",
    useCallback(() => showFlash("Back on track", 1000), [showFlash]),
  );
  useUnityEvent<{ strength: number }>(
    "impact",
    useCallback((e) => {
      sfx.impact(e.strength);
      haptic(e.strength > 0.5 ? "heavy" : "medium");
    }, []),
  );
  useUnityEvent(
    "boost",
    useCallback(() => {
      sfx.boost();
      haptic("medium");
    }, []),
  );
  useUnityEvent(
    "drift",
    useCallback(() => haptic("tap"), []),
  );
  useUnityEvent<RaceFinished>(
    "raceFinished",
    useCallback(
      (result) => {
        stopEngine();
        sfx.finish();
        haptic("success");
        setFinish({ totalMs: result.totalMs, delta: opponent ? result.totalMs - opponent.totalMs : null });
        window.setTimeout(() => onFinish(result), 1900);
      },
      [onFinish, opponent],
    ),
  );

  const lap = hud ? Math.min(hud.lap, hud.laps) : 1;
  const laps = hud?.laps ?? track.laps;

  return (
    <div className="screen race">
      <div className="hud">
        <LapRing lap={lap} laps={laps} />
        <div className="hud-center">
          <div className="hud-time">{formatTime(hud?.timeMs ?? 0)}</div>
          {opponent && (
            <div key={delta ?? "none"} className={`hud-delta ${delta == null ? "" : delta < 0 ? "ahead" : "behind"}`}>
              <span>{opponent.name}</span>
              <b>
                {delta != null && <i aria-hidden>{delta < 0 ? "▲" : "▼"}</i>}
                {delta == null ? formatTime(opponent.totalMs) : formatDelta(delta)}
              </b>
            </div>
          )}
        </div>
        <Minimap track={track} hud={hud} />
      </div>

      <SpeedLines hud={hud} />
      <Speedometer hud={hud} />

      {go !== null && (
        <div className="start-lights" aria-live="polite">
          <div className="lights">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={go ? "on-green" : lights >= i ? "on" : ""} />
            ))}
          </div>
          {go && <div className="go-text">GO</div>}
        </div>
      )}

      {flash && !finish && <div className="flash">{flash}</div>}
      {hud?.boost && !finish && <div className="boost-vignette" />}

      {go === false && (
        <div className="touch-hint">
          {steering === "tilt" ? (
            <>
              <span>Tilt to steer</span>
              <span>Touch to brake · hold while turning to drift</span>
            </>
          ) : (
            <>
              <span>◀ Hold left</span>
              <span>Both thumbs to drift · release to boost</span>
              <span>Hold right ▶</span>
            </>
          )}
        </div>
      )}

      {finish && (
        <div className="finish">
          <Confetti pieces={26} />
          <div className="finish-flag" />
          <h1>FINISH</h1>
          <div className="finish-time">{formatTime(finish.totalMs)}</div>
          {finish.delta != null && opponent && (
            <div className={`finish-delta ${finish.delta < 0 ? "ahead" : "behind"}`}>
              {finish.delta < 0 ? `Beat ${opponent.name} by ${(-finish.delta / 1000).toFixed(2)}s` : `${formatDelta(finish.delta)} to ${opponent.name}`}
            </div>
          )}
        </div>
      )}

      {!finish && (
        <button className="quit" onClick={onQuit} aria-label="Quit race">
          ✕
        </button>
      )}
    </div>
  );
}

function Minimap({ track, hud }: { track: Track; hud: Hud | null }) {
  const size = 96;
  const shape = useMemo(() => trackShape(track.points, size), [track]);
  const car = hud ? shape.toMap(hud.x, hud.z) : null;
  const ghost = hud?.ghost ? shape.toMap(hud.gx, hud.gz) : null;
  return (
    <svg className="minimap" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
      <path d={shape.path} className="mm-road" />
      <path d={shape.path} className="mm-line" />
      <circle cx={shape.start[0]} cy={shape.start[1]} r={2.5} className="mm-start" />
      {ghost && <circle cx={ghost[0]} cy={ghost[1]} r={3.2} className="mm-ghost" />}
      {car && <circle cx={car[0]} cy={car[1]} r={3.8} className="mm-car" />}
    </svg>
  );
}

/** Speed arc with a drift-charge ring inside it. */
function Speedometer({ hud }: { hud: Hud | null }) {
  const speed = hud?.speedKmh ?? 0;
  const r = 52;
  const arc = Math.PI * 1.5 * r;
  const speedFrac = Math.min(1, speed / TOP_KMH);
  const charge = (hud?.charge ?? 0) / 100;
  const r2 = 42;
  const arc2 = Math.PI * 1.5 * r2;
  const state = hud?.boost ? "boost" : hud?.drift ? "drift" : "";
  const ticks = Array.from({ length: 13 }, (_, i) => 135 + (i * 270) / 12);
  return (
    <div className={`speedo ${state}`} style={{ ["--v" as string]: speedFrac }}>
      <svg viewBox="0 0 130 130" width={130} height={130} aria-hidden>
        <defs>
          <linearGradient id="sp-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="0.6" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#f472b6" />
          </linearGradient>
          <linearGradient id="sp-boost" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <g className="sp-ticks">
          {ticks.map((a, i) => (
            <line
              key={a}
              x1={65 + 60 * Math.cos((a * Math.PI) / 180)}
              y1={65 + 60 * Math.sin((a * Math.PI) / 180)}
              x2={65 + (i % 3 === 0 ? 55 : 57.5) * Math.cos((a * Math.PI) / 180)}
              y2={65 + (i % 3 === 0 ? 55 : 57.5) * Math.sin((a * Math.PI) / 180)}
              className={i / 12 <= speedFrac ? "lit" : ""}
            />
          ))}
        </g>
        <g transform="rotate(135 65 65)">
          <circle cx={65} cy={65} r={r} className="sp-track" strokeDasharray={`${arc} 999`} />
          <circle cx={65} cy={65} r={r} className="sp-fill" strokeDasharray={`${arc * speedFrac} 999`} />
          <circle cx={65} cy={65} r={r2} className="sp-track thin" strokeDasharray={`${arc2} 999`} />
          <circle cx={65} cy={65} r={r2} className="sp-charge" strokeDasharray={`${arc2 * charge} 999`} />
        </g>
      </svg>
      <div className="sp-readout">
        <b>{speed}</b>
        <span>km/h</span>
      </div>
      <div className="sp-label">{hud?.boost ? "BOOST" : hud?.drift ? "DRIFT" : ""}</div>
    </div>
  );
}

/** Lap counter inside a ring that fills a segment per lap. */
function LapRing({ lap, laps }: { lap: number; laps: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = laps > 0 ? Math.min(1, (lap - 1) / laps) : 0;
  return (
    <div className="hud-lap">
      <svg viewBox="0 0 56 56" width={56} height={56} aria-hidden>
        <circle cx={28} cy={28} r={r} className="lap-track" />
        <circle cx={28} cy={28} r={r} className="lap-fill" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <div className="hud-lap-text">
        <small>LAP</small>
        <b>
          {lap}
          <span>/{laps}</span>
        </b>
      </div>
    </div>
  );
}

/** Motion streaks at the edges of the view that thicken with speed and flare on boost. */
function SpeedLines({ hud }: { hud: Hud | null }) {
  const v = Math.min(1, (hud?.speedKmh ?? 0) / TOP_KMH);
  const strength = hud?.boost ? 1 : Math.max(0, (v - 0.45) / 0.55);
  if (strength <= 0) return null;
  return <div className={`speed-lines ${hud?.boost ? "boost" : ""}`} style={{ opacity: strength }} aria-hidden />;
}
