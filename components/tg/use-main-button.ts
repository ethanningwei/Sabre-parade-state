"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { mainButton, webApp } from "./webapp";

const noSubscribe = () => () => {};

/**
 * Hands a form's submit button to Telegram's MainButton: Telegram draws it at
 * the bottom of the Mini App, above the keyboard, in the theme's colour, with
 * its own spinner. A tap clicks our (hidden) button, so the form submits as
 * before. Returns true when Telegram has it, so the page hides its own; in a
 * browser it returns false and nothing changes. `dim` greys it while the form
 * isn't complete; it stays enabled, so a tap still reaches our button, which
 * says what's missing (a disabled MainButton ignores taps).
 */
export function useMainButton(button: RefObject<HTMLButtonElement | null>, { pending, dim, off }: { pending: boolean; dim: boolean; off?: boolean }) {
  // read on every render, false on the server: no hydration mismatch
  const native = useSyncExternalStore(noSubscribe, () => !!mainButton(), () => false) && !off;

  useEffect(() => {
    const mb = mainButton();
    if (!native || !mb) return;
    const click = () => button.current?.click();
    mb.onClick(click);
    return () => {
      mb.offClick(click);
      mb.hideProgress();
      mb.hide();
    };
  }, [native, button]);

  // the label, state and spinner follow the button on every render
  useEffect(() => {
    const mb = mainButton();
    if (!native || !mb) return;
    mb.setText(button.current?.textContent?.trim() || "Continue");
    if (pending) mb.showProgress(false);
    else mb.hideProgress();
    const theme = webApp()?.themeParams ?? {};
    const grey = dim && !pending && theme.hint_color;
    mb.setParams?.({
      color: (grey ? theme.hint_color : theme.button_color) ?? undefined,
      text_color: (grey ? theme.bg_color : theme.button_text_color) ?? undefined,
    });
    mb.enable();
    mb.show();
  });

  return native;
}
