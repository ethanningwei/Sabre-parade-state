// The slice of telegram-web-app.js (core.telegram.org/bots/webapps) the Mini App uses.

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string | undefined>;
  ready(): void;
  expand(): void;
  onEvent(event: "themeChanged", cb: () => void): void;
  offEvent(event: "themeChanged", cb: () => void): void;
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: "bg_color" | "secondary_bg_color" | `#${string}`): void;
  setBackgroundColor?(color: "bg_color" | "secondary_bg_color" | `#${string}`): void;
  /** Telegram's own button at the bottom of the Mini App, outside the page (6.0+). */
  MainButton?: {
    isVisible: boolean;
    setText(text: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    notificationOccurred(type: "error" | "success" | "warning"): void;
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    selectionChanged(): void;
  };
}

export function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

// Haptics, inside Telegram only: without launch data (a plain browser, or /tg
// opened outside Telegram) there's nothing to buzz, and telegram-web-app.js
// would only warn that it's unsupported.
const haptics = () => {
  const app = webApp();
  return app?.initData ? app.HapticFeedback : undefined;
};

/** A light tick when an answer is picked. */
export const tick = () => haptics()?.selectionChanged();
/** A light tap on any button or link (see useTapHaptics). */
export const tap = () => haptics()?.impactOccurred("light");
/** Something saved. */
export const buzzSuccess = () => haptics()?.notificationOccurred("success");
/** Something refused or failed. */
export const buzzError = () => haptics()?.notificationOccurred("error");

/** Telegram's MainButton, inside Telegram only (a browser keeps the page's own button). */
export const mainButton = () => {
  const app = webApp();
  return app?.initData ? app.MainButton : undefined;
};
