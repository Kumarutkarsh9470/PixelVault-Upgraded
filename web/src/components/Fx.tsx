// Motion and depth for the overlay: drifting light particles, slow colour
// aurora behind the panels, pointer tilt on cards, and numbers that count.
import { useEffect, useRef, useState, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Soft light motes drifting up the screen, on a canvas that costs almost nothing. */
export function Particles({ count = 34 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    type Mote = { x: number; y: number; r: number; vy: number; sway: number; phase: number; hue: number; a: number };
    let motes: Mote[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();

    const spawn = (fromBottom: boolean): Mote => ({
      x: Math.random() * width,
      y: fromBottom ? height + 10 : Math.random() * height,
      r: 0.8 + Math.random() * 2.2,
      vy: 8 + Math.random() * 18,
      sway: 6 + Math.random() * 14,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.6 ? 190 : 320,
      a: 0.25 + Math.random() * 0.5,
    });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = Array.from({ length: count }, () => spawn(false));
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.y -= m.vy * dt;
        m.phase += dt * 0.9;
        const x = m.x + Math.sin(m.phase) * m.sway;
        if (m.y < -10) motes[i] = spawn(true);
        const glow = ctx.createRadialGradient(x, m.y, 0, x, m.y, m.r * 4);
        glow.addColorStop(0, `hsla(${m.hue}, 90%, 70%, ${m.a})`);
        glow.addColorStop(1, `hsla(${m.hue}, 90%, 70%, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, m.y, m.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(tick);
    };

    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [count]);

  return <canvas ref={ref} className="fx-particles" aria-hidden />;
}

/** Slow colour wash behind the panels; pure CSS, three blurred blobs. */
export function Aurora() {
  return (
    <div className="fx-aurora" aria-hidden>
      <i />
      <i />
      <i />
    </div>
  );
}

/**
 * Pointer tilt for anything carrying data-tilt. One delegated listener; cards
 * get a little rotateX/rotateY toward the pointer and a glare that follows it.
 * Touch devices skip it (there is no hover to follow).
 */
export function useTilt() {
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover)").matches || reducedMotion()) return;
    const MAX = 7;
    let active: HTMLElement | null = null;

    const reset = (el: HTMLElement) => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--glare", "0");
    };

    const move = (e: PointerEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (active && active !== target) reset(active);
      active = target;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      target.style.setProperty("--ry", `${((px - 0.5) * 2 * MAX).toFixed(2)}deg`);
      target.style.setProperty("--rx", `${((0.5 - py) * 2 * MAX).toFixed(2)}deg`);
      target.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
      target.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      target.style.setProperty("--glare", "1");
    };

    const leave = () => {
      if (active) reset(active);
      active = null;
    };

    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);
}

/** Eases a number toward its target so totals tick instead of jumping. */
export function useAnimatedValue(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const start = useRef(0);

  useEffect(() => {
    if (reducedMotion() || duration <= 0) {
      setValue(target);
      return;
    }
    const begin = from.current;
    const delta = target - begin;
    if (delta === 0) return;
    start.current = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = begin + delta * eased;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, duration]);

  return value;
}

export function AnimatedNumber({
  value,
  format,
  duration,
}: {
  value: number;
  format: (v: number) => ReactNode;
  duration?: number;
}) {
  const v = useAnimatedValue(value, duration);
  return <>{format(Math.round(v))}</>;
}

/** A burst of coloured flakes for a gold medal or a new best. */
export function Confetti({ pieces = 18 }: { pieces?: number }) {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: pieces }, (_, i) => (
        <span key={i} style={{ ["--i" as string]: i }} />
      ))}
    </div>
  );
}

export function NavIcon({ kind }: { kind: "race" | "garage" | "vault" | "ranks" | "run" | "forge" }) {
  const paths: Record<typeof kind, string> = {
    race: "M4 17h16M6 17l2-6h8l2 6M9 11V7h6v4",
    garage: "M3 11l9-7 9 7v9H3zM8 20v-6h8v6",
    vault: "M4 5h16v14H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 12h3",
    ranks: "M5 20V10M12 20V4M19 20v-7",
    run: "M13 4l-2 6h4l-2 6M6 20h12",
    forge: "M6 20h12M8 20V9l4-5 4 5v11M10 14h4",
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[kind]} />
    </svg>
  );
}
