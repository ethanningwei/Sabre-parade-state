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
  HapticFeedback?: { notificationOccurred(type: "error" | "success" | "warning"): void };
}

export function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}
