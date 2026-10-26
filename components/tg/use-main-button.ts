"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { mainButton } from "./webapp";

const noSubscribe = () => () => {};

/**
 * Hands a form's submit button to Telegram's MainButton: Telegram draws it at
 * the bottom of the Mini App, above the keyboard, in the theme's colour, with
 * its own spinner. A tap clicks our (hidden) button, so the form submits as
 * before. Returns true when Telegram has it, so the page hides its own; in a
 * browser it returns false and nothing changes.
 */
export function useMainButton(button: RefObject<HTMLButtonElement | null>, { pending, disabled }: { pending: boolean; disabled: boolean }) {
  // read on every render, false on the server: no hydration mismatch
  const native = useSyncExternalStore(noSubscribe, () => !!mainButton(), () => false);

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
    if (disabled && !pending) mb.disable();
    else mb.enable();
    mb.show();
  });

  return native;
}
