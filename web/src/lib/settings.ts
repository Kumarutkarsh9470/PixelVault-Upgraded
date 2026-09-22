// Player preferences, kept in this browser only.
import { useSyncExternalStore } from "react";

export type Settings = {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  /** "touch": hold left/right, both thumbs to drift. "tilt": steer by tilting, touch to brake/drift. */
  steering: "touch" | "tilt";
  effects: boolean;
};

const KEY = "pv_settings";
const defaults: Settings = { sound: true, music: true, haptics: true, steering: "touch", effects: true };
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return defaults;
  }
}

let current = load();

export const settings = {
  get: () => current,
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Storage can be unavailable (private mode); settings still apply this session.
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}
