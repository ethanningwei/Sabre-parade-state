"use client";

import "@/app/(tg)/tg/telegram-theme.css";
import { ArrowLeft } from "lucide-react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { v1BackLeaves } from "@/lib/wb/domain/parade-links";
import { webApp } from "./webapp";

// Telegram's chrome on the v1 web app, for a session started by the Mini App's
// "Parade state" (v1's layout renders this only then: fromTelegram()). Inside
// Telegram, v1 takes Telegram's colours, as the Mini App does, and Telegram's
// own Back button is the way around: from a tab screen it leaves for the Mini
// App, from anything deeper it goes back one screen (which may be the Mini App
// screen that linked here). telegram-web-app.js keeps the launch data in
// sessionStorage, so it still knows it's inside Telegram after the navigation.
// Without that launch data (or the script), a "Back to Sabre" strip instead.
// The theme CSS is scoped to :root.tg-themed, which only this adds.

// The Mini App has its own layout and sign-in, so leaving is a full page load.
// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose (see above)
const leave = () => window.location.assign("/tg");

export function BackToSabre() {
  const [inTelegram, setInTelegram] = useState<boolean | null>(null);
  const onReady = useCallback(() => setInTelegram(!!webApp()?.initData), []);
  const onError = useCallback(() => setInTelegram(false), []);
  const pathname = usePathname();

  useEffect(() => {
    const app = webApp();
    if (!inTelegram || !app) return;
    app.ready();
    const root = document.documentElement;
    const apply = () => {
      root.classList.add("tg-themed");
      root.classList.toggle("dark", app.colorScheme === "dark");
      // Telegram's header and overscroll match v1's page, the Mini App's (--page)
      if (app.isVersionAtLeast?.("6.1")) {
        app.setHeaderColor?.("secondary_bg_color");
        app.setBackgroundColor?.("secondary_bg_color");
      }
    };
    apply();
    app.onEvent("themeChanged", apply);
    return () => {
      app.offEvent("themeChanged", apply);
      root.classList.remove("tg-themed");
    };
  }, [inTelegram]);

  useEffect(() => {
    const app = webApp();
    if (!inTelegram || !app) return;
    const back = () => (v1BackLeaves(pathname) || window.history.length < 2 ? leave() : window.history.back());
    app.BackButton.onClick(back);
    app.BackButton.show();
    return () => app.BackButton.offClick(back);
  }, [inTelegram, pathname]);

  // signed out (v1's /login has no layout of ours): no Back button left behind
  useEffect(() => {
    const app = webApp();
    if (!inTelegram || !app) return;
    return () => app.BackButton.hide();
  }, [inTelegram]);

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={onReady} onError={onError} />
      {inTelegram === false && (
        <div className="border-b bg-primary/8">
          <a
            href="/tg"
            className="mx-auto flex h-11 w-full max-w-2xl items-center gap-2 px-4 text-sm font-medium text-primary active:opacity-70"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to Sabre
          </a>
        </div>
      )}
    </>
  );
}
