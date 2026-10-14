"use client";

import { ArrowLeft } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import { webApp } from "./webapp";

// The way back to the Mini App from the v1 web app, for a session started by
// its "Parade state" tile. v1's layout renders this only then (fromTelegram()).
// The Mini App has its own layout and sign-in, so both ways back are full page loads.

// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose (see above)
const goBack = () => window.location.assign("/tg");

export function BackToSabre() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  // Telegram's own Back button. telegram-web-app.js keeps the launch data in
  // sessionStorage, so it still knows it's inside Telegram after the Mini App
  // has navigated here. In a plain browser there's no initData: nothing to show.
  useEffect(() => {
    const app = webApp();
    if (!ready || !app?.initData) return;
    app.ready();
    app.BackButton.onClick(goBack);
    app.BackButton.show();
    return () => {
      app.BackButton.offClick(goBack);
      app.BackButton.hide();
    };
  }, [ready]);

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={onReady} />
      <div className="border-b bg-primary/8">
        <a
          href="/tg"
          className="mx-auto flex h-11 w-full max-w-2xl items-center gap-2 px-4 text-sm font-medium text-primary active:opacity-70"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to Sabre
        </a>
      </div>
    </>
  );
}
