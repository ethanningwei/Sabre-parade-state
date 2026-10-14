import "server-only";
import { cookies } from "next/headers";
import { isEnabled } from "@/lib/flags";

// Marks a v1 session started from the Mini App's "Parade state" tile, so v1's
// layout offers the way back to Sabre. Nothing here exists with
// FEATURE_WHEREABOUTS off: v1 never sees the cookie and never sets or clears it.

export const FROM_TG_COOKIE = "sabre_from_tg";
/** v1's session length (lib/session.ts SESSION_DAYS), so both cookies end together. */
const FROM_TG_DAYS = 30;

export async function markFromTelegram() {
  (await cookies()).set(FROM_TG_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(Date.now() + FROM_TG_DAYS * 24 * 60 * 60 * 1000),
  });
}

/** v1's layout: show "Back to Sabre"? Always false with the flag off, without reading the cookie. */
export async function fromTelegram(): Promise<boolean> {
  if (!isEnabled("WHEREABOUTS")) return false;
  return (await cookies()).get(FROM_TG_COOKIE)?.value === "1";
}

/** v1's sign-out. A no-op with the flag off, so v1's response is unchanged. */
export async function forgetFromTelegram() {
  if (!isEnabled("WHEREABOUTS")) return;
  (await cookies()).delete(FROM_TG_COOKIE);
}
