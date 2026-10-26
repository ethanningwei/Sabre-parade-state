"use client";

import { Loader2 } from "lucide-react";
import Script from "next/script";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { startParamToPath } from "@/lib/wb/telegram/links";
import { webApp } from "./webapp";

/**
 * Wraps every Mini App page: loads Telegram's script, takes Telegram's colours,
 * drives the BackButton, and signs in with initData when there's no session.
 */
export function TgShell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={onReady} />
      {ready && <TelegramChrome signedIn={signedIn} />}
      <div className="tg-app flex min-h-dvh flex-1 flex-col">
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col pt-[calc(1rem+env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(2rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
          {signedIn ? children : <SignIn ready={ready} />}
        </main>
      </div>
    </>
  );
}

/** Theme + BackButton, and deep links. Rendered once the script has loaded. */
function TelegramChrome({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const followed = useRef(false);

  // A t.me/<bot>/app?startapp=... link (a card's Open) always lands on /tg.
  // Signed out, SignIn follows it after sign-in; signed in, follow it here,
  // once, so Back to Home doesn't bounce to the record again.
  useEffect(() => {
    if (!signedIn || followed.current) return;
    followed.current = true;
    const to = startParamToPath(webApp()?.initDataUnsafe.start_param);
    if (to !== "/tg" && pathname === "/tg") router.replace(to);
  }, [signedIn, pathname, router]);

  useEffect(() => {
    const app = webApp();
    if (!app?.initData) return; // a plain browser: keep the app's own theme
    app.ready();
    app.expand();
    const root = document.documentElement;
    const apply = () => {
      root.classList.add("tg-themed");
      root.classList.toggle("dark", app.colorScheme === "dark");
      // Telegram's own header and overscroll match the page (--page, globals.css)
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
  }, []);

  useEffect(() => {
    const app = webApp();
    if (!app?.initData) return;
    if (pathname === "/tg") {
      app.BackButton.hide();
      return;
    }
    // opened straight onto a deep link there's no history to go back to
    const back = () => (window.history.length > 1 ? router.back() : router.replace("/tg"));
    app.BackButton.onClick(back);
    app.BackButton.show();
    return () => app.BackButton.offClick(back);
  }, [pathname, router]);

  return null;
}

function SignIn({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);
  const initData = ready ? (webApp()?.initData ?? "") : null;
  const message = initData === "" ? "Open Sabre from the bot in Telegram." : error;

  useEffect(() => {
    if (!initData || tried.current) return;
    tried.current = true;
    fetch("/api/wb/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string; startParam?: string | null };
        if (!res.ok) throw new Error(body.error ?? "Couldn't sign you in.");
        const to = startParamToPath(body.startParam);
        // a refresh re-renders the layout with the new cookie; a deep link
        // reloads instead, since a client navigation would keep this layout
        if (to === "/tg") router.refresh();
        else window.location.replace(to);
      })
      .catch((e: Error) => setError(e.message || "Couldn't sign you in."));
  }, [initData, router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Logo className="size-14 rounded-2xl" />
      {message ? (
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Signing you in…
        </p>
      )}
    </div>
  );
}
