import { useEffect, useRef, useState } from "react";

import { loadUnity } from "../lib/unity";

/** The game canvas, mounted once and kept behind every screen. */
export function UnityStage({ onReady }: { onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    loadUnity(canvas.current, setProgress)
      .then(() => {
        setLoaded(true);
        onReady();
      })
      .catch((e) => setFailed(e.message));
  }, [onReady]);

  return (
    <>
      {/* Unity's runtime looks the canvas up by id, so it must have one. */}
      <canvas ref={canvas} id="unity-canvas" className="unity-canvas" tabIndex={-1} />
      {!loaded && (
        <div className="boot">
          <div className="boot-logo">
            PIXEL<span>VAULT</span>
          </div>
          <div className="boot-bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="muted">{failed ?? "Warming up the engine"}</p>
        </div>
      )}
    </>
  );
}
