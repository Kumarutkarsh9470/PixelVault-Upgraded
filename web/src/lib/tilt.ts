// Tilt steering: reads the phone's orientation and streams a -1..1 steer value
// to Unity. iOS asks for motion permission, which must come from a tap.
import { sendToUnity } from "./unity";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

const FULL_LOCK_DEGREES = 22;
let listening = false;
let last = 0;
let lastSent = 0;

function onOrientation(e: DeviceOrientationEvent) {
  const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
  // Portrait uses left/right roll (gamma); landscape uses beta, signed by which way the phone is turned.
  let tilt = angle === 90 ? (e.beta ?? 0) : angle === -90 || angle === 270 ? -(e.beta ?? 0) : (e.gamma ?? 0);
  tilt = Math.max(-1, Math.min(1, tilt / FULL_LOCK_DEGREES));
  // A small dead zone keeps the car straight when the phone is roughly level.
  const steer = Math.abs(tilt) < 0.06 ? 0 : tilt;
  const now = performance.now();
  if (Math.abs(steer - last) > 0.02 && now - lastSent > 30) {
    last = steer;
    lastSent = now;
    sendToUnity("SetTilt", steer.toFixed(3));
  }
}

export function tiltSupported(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

/** Call from a tap. Resolves false if the device or the player refuses. */
export async function requestTilt(): Promise<boolean> {
  if (!tiltSupported()) return false;
  const permission = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
  if (permission) {
    try {
      if ((await permission()) !== "granted") return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function setSteering(mode: "touch" | "tilt") {
  sendToUnity("SetInputMode", mode);
  if (mode === "tilt" && !listening) {
    window.addEventListener("deviceorientation", onOrientation);
    listening = true;
  } else if (mode === "touch" && listening) {
    window.removeEventListener("deviceorientation", onOrientation);
    listening = false;
  }
}
