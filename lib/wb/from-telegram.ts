import "server-only";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { appSession } from "@/lib/db/schema";
import { isEnabled } from "@/lib/flags";
import { SESSION_COOKIE } from "@/lib/session";

// Marks a v1 session started from the Mini App's "Parade state" tile, so v1's
// layout offers the way back to Sabre. Nothing here exists with
// FEATURE_WHEREABOUTS off: v1 never sees the cookie and never sets or clears it.
//
// Both cookies of such a session (this marker and v1's session) are "embedded":
// SameSite=None, Secure, Partitioned, like the Mini App's own wb_session, so they
// survive Telegram Web running the Mini App inside its own page's frame.

export const FROM_TG_COOKIE = "sabre_from_tg";
/** v1's session length (lib/session.ts SESSION_DAYS), so both cookies end together. */
const FROM_TG_DAYS = 30;
/** A cookie that also works inside another site's frame. Clearing one takes the same attributes. */
const EMBEDDED = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };

export async function markFromTelegram() {
  (await cookies()).set(FROM_TG_COOKIE, "1", { ...EMBEDDED, expires: new Date(Date.now() + FROM_TG_DAYS * 24 * 60 * 60 * 1000) });
}

/** v1's layout: show "Back to Sabre"? Always false with the flag off, without reading the cookie. */
export async function fromTelegram(): Promise<boolean> {
  if (!isEnabled("WHEREABOUTS")) return false;
  return (await cookies()).get(FROM_TG_COOKIE)?.value === "1";
}

/** Every v1 session token the browser sent: one opened from the Mini App before 2026-10-19 may sit beside today's. */
function sessionTokens(cookieHeader: string | null): string[] {
  return (cookieHeader ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .filter(([k, v]) => k === SESSION_COOKIE && !!v)
    .map(([, v]) => decodeURIComponent(v));
}

/**
 * v1's sign-out, after its own. A no-op with the flag off, so v1's response is
 * unchanged. For a session opened from the Mini App: every session the browser
 * holds ends, and both cookies are cleared the embedded way (v1's own plain
 * delete can't reach a partitioned cookie).
 */
export async function forgetFromTelegram() {
  if (!isEnabled("WHEREABOUTS")) return;
  const jar = await cookies();
  if (!jar.get(FROM_TG_COOKIE)) return;
  const tokens = sessionTokens((await headers()).get("cookie"));
  if (tokens.length) {
    await db.delete(appSession).where(inArray(appSession.tokenHash, tokens.map((t) => createHash("sha256").update(t).digest("hex"))));
  }
  jar.set(SESSION_COOKIE, "", { ...EMBEDDED, maxAge: 0 });
  jar.set(FROM_TG_COOKIE, "", { ...EMBEDDED, maxAge: 0 });
}
