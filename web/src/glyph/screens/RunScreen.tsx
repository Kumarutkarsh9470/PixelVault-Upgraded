import { useCallback, useEffect, useState } from "react";

import { sfx } from "../../lib/audio";
import { haptic } from "../../lib/telegram";
import { formatDistance } from "../api";
import { runner, type RunHud, type RuneEvent } from "../unity";

const HINT_KEY = "gf_seen_hint";

/** The run's overlay: countdown, distance, runes, and a way out. Touches pass through to the game. */
export function RunScreen({ countdown, onQuit }: { countdown: number; onQuit: () => void }) {
  const [hud, setHud] = useState<RunHud | null>(null);
  const [hint, setHint] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return true;
    }
  });

  runner.useEvent<RunHud>("hud", useCallback((h: RunHud) => setHud(h), []));
  runner.useEvent<RuneEvent>(
    "rune",
    useCallback(() => {
      sfx.checkpoint(true);
      haptic("tap");
    }, []),
  );

  useEffect(() => {
    if (!hint || countdown > 0) return;
    const timer = setTimeout(() => {
      setHint(false);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        // Shown again next time; harmless.
      }
    }, 3500);
    return () => clearTimeout(timer);
  }, [hint, countdown]);

  const kmh = hud ? Math.round((hud.speedMmPerSecond * 3.6) / 1000) : 43;

  return (
    <div className="screen race glyph-run">
      <div className="hud">
        <div className="hud-center">
          <div className="hud-time">{formatDistance(hud?.distanceMm ?? 0)}</div>
          <div className="glyph-speed">{kmh} km/h</div>
        </div>
        <div className="glyph-runes">
          <span style={{ ["--c" as string]: "#fb7185" }}>{hud?.ember ?? 0}</span>
          <span style={{ ["--c" as string]: "#38bdf8" }}>{hud?.tide ?? 0}</span>
          <span style={{ ["--c" as string]: "#c084fc" }}>{hud?.storm ?? 0}</span>
        </div>
      </div>

      {countdown > 0 && (
        <div className="start-lights" aria-live="polite">
          <div className="go-text">{countdown}</div>
        </div>
      )}

      {hint && countdown === 0 && (
        <div className="touch-hint">
          <p>Swipe ← → to change lanes · ↑ to jump · ↓ to slide</p>
        </div>
      )}

      <button className="quit" onClick={onQuit} aria-label="End run">
        ✕
      </button>
    </div>
  );
}
