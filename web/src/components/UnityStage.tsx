import { useEffect, useRef, useState } from "react";

const TIPS = [
  "Every item holds USDC in a vault the studio cannot touch.",
  "Redeem any item, any time. No buyer needed.",
  "Drift through long corners to charge a boost.",
  "Move an item between games in one transaction.",
  "You never hold SOL. A relayer pays every fee.",
];

import { loadUnity, type UnityBridge } from "../lib/unity";

/** The game canvas, mounted once and kept behind every screen. */
export function UnityStage({ onReady, load = loadUnity }: { onReady: () => void; load?: UnityBridge["load"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [tip, setTip] = useState(0);

  useEffect(() => {
    if (loaded) return;
    const timer = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 2600);
    return () => clearInterval(timer);
  }, [loaded]);

  useEffect(() => {
    if (!canvas.current) return;
    load(canvas.current, setProgress)
      .then(() => {
        setLoaded(true);
        onReady();
      })
      .catch((e) => setFailed(e.message));
  }, [onReady, load]);

  return (
    <>
      {/* Unity's runtime looks the canvas up by id, so it must have one. */}
      <canvas ref={canvas} id="unity-canvas" className="unity-canvas" tabIndex={-1} />
      {!loaded && (
        <div className="boot">
          <div className="boot-ring" aria-hidden>
            <i />
          </div>
          <div className="boot-logo">
            PIXEL<span>VAULT</span>
          </div>
          <div className="boot-bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="boot-status">{failed ?? `Warming up the engine · ${Math.round(progress * 100)}%`}</p>
          <p key={tip} className="boot-tip muted small">
            {TIPS[tip]}
          </p>
        </div>
      )}
    </>
  );
}
