// Loads the Unity build once and exposes a tiny message bridge.
// Page -> Unity: send(method, payload) calls a method on the "Bridge" object.
// Unity -> page: window events named "pixelvault:<type>".
import { useEffect } from "react";

type UnityInstance = { SendMessage: (target: string, method: string, value: string) => void };

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
      onProgress?: (progress: number) => void,
    ) => Promise<UnityInstance>;
  }
}

const BUILD = "/Build";
let instance: UnityInstance | null = null;
let loading: Promise<UnityInstance> | null = null;
const queue: Array<[string, string]> = [];

export function loadUnity(canvas: HTMLCanvasElement, onProgress: (p: number) => void): Promise<UnityInstance> {
  if (loading) return loading;
  loading = new Promise<UnityInstance>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${BUILD}/WebGL.loader.js`;
    script.onerror = () => reject(new Error("failed to load the game engine"));
    script.onload = () => {
      window
        .createUnityInstance!(
          canvas,
          {
            dataUrl: `${BUILD}/WebGL.data.br`,
            frameworkUrl: `${BUILD}/WebGL.framework.js.br`,
            codeUrl: `${BUILD}/WebGL.wasm.br`,
            companyName: "PixelVault",
            productName: "PixelVault Racer",
            productVersion: "1.0",
            devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          },
          onProgress,
        )
        .then((unity) => {
          instance = unity;
          for (const [method, value] of queue.splice(0)) unity.SendMessage("Bridge", method, value);
          resolve(unity);
        })
        .catch(reject);
    };
    document.body.appendChild(script);
  });
  return loading;
}

/** Sends a message to Unity, queueing it until the engine has loaded. */
export function sendToUnity(method: string, payload?: unknown) {
  const value = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  if (instance) instance.SendMessage("Bridge", method, value);
  else queue.push([method, value]);
}

// ?debug exposes the bridge for testing scenes from the console. It grants
// nothing a player could not already do in their own client: runs are still
// checked by the server.
if (new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { pvDebug: unknown }).pvDebug = { send: sendToUnity };
}

export function onUnity<T = unknown>(type: string, handler: (detail: T) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(`pixelvault:${type}`, listener);
  return () => window.removeEventListener(`pixelvault:${type}`, listener);
}

export function useUnityEvent<T = unknown>(type: string, handler: (detail: T) => void) {
  useEffect(() => onUnity(type, handler), [type, handler]);
}

export type Loadout = { chassis: string; underglow: string; trail: string };

export type RaceFinished = {
  trackId: string;
  totalMs: number;
  laps: number;
  respawns: number;
  splits: number[];
  ghost: { interval: number; samples: number[] };
};

export type Hud = {
  timeMs: number;
  lap: number;
  laps: number;
  speedKmh: number;
  /** Car and ghost on the ground plane, in track coordinates. */
  x: number;
  z: number;
  gx: number;
  gz: number;
  ghost: boolean;
  drift: boolean;
  /** Drift boost charge, 0-100. */
  charge: number;
  boost: boolean;
};

export type CheckpointEvent = { index: number; lap: number; timeMs: number };
