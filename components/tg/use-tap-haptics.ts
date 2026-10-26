"use client";

import { useEffect } from "react";
import { tap } from "./webapp";

// What counts as a tap: anything you press. A <label> isn't listed: tapping one
// clicks its input, which is. A control that buzzes itself
// (Choice's tick, a pick list's tick) carries data-haptic="own".
const TAPPABLE =
  'a[href], button:not(:disabled), summary, [role="button"], [role="switch"], [role="checkbox"], input[type="checkbox"], input[type="radio"]';

/** A light tap on every press, from one listener rather than every button. Telegram only (tap() checks). */
export function useTapHaptics(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(TAPPABLE);
      if (!el || el.closest('[data-haptic="own"]')) return;
      tap();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [enabled]);
}
