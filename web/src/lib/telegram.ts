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

export function haptic(kind: "tap" | "success" | "error") {
  const h = webApp?.HapticFeedback;
  if (kind === "tap") h?.impactOccurred?.("light");
  else h?.notificationOccurred?.(kind);
}
