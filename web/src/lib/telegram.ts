import { settings } from "./settings";

type WebApp = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number; username?: string; first_name?: string } };
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred?: (type: "success" | "warning" | "error") => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp: WebApp | undefined = window.Telegram?.WebApp;

export const inTelegram = !!webApp?.platform && webApp.platform !== "unknown";

/** Telegram's signed launch data; the backend verifies it to identify the player. */
export function initData(): string {
  return webApp?.initData ?? "";
}

export function telegramName(): string | null {
  const user = webApp?.initDataUnsafe?.user;
  return user?.username ? "@" + user.username : user?.first_name ?? null;
}

export function prepareTelegram() {
  webApp?.ready?.();
  webApp?.expand?.();
  // Stops a downward swipe while steering from minimising the Mini App.
  webApp?.disableVerticalSwipes?.();
  webApp?.setHeaderColor?.("#070b17");
  webApp?.setBackgroundColor?.("#070b17");
}

export type HapticKind = "tap" | "medium" | "heavy" | "success" | "error";

const VIBRATE: Record<HapticKind, number | number[]> = { tap: 8, medium: 18, heavy: 35, success: [12, 40, 12], error: [30, 30, 30] };

export function haptic(kind: HapticKind) {
  if (!settings.get().haptics) return;
  const h = webApp?.HapticFeedback;
  if (h) {
    if (kind === "tap") h.impactOccurred?.("light");
    else if (kind === "medium" || kind === "heavy") h.impactOccurred?.(kind);
    else h.notificationOccurred?.(kind);
  } else {
    navigator.vibrate?.(VIBRATE[kind]);
  }
}
