import "server-only";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { appSession, loginFailure, user } from "@/lib/db/schema";
import { forgetFromTelegram } from "@/lib/wb/from-telegram";

export const SESSION_COOKIE = "sabre_session";
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set (use: openssl rand -base64 32)");
  return s;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Changes whenever APP_PASSWORD changes, so old sessions stop working. */
function passwordTag(): string {
  return createHmac("sha256", secret()).update(process.env.APP_PASSWORD ?? "").digest("hex");
}

export function passwordMatches(attempt: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD is not set");
  // compare fixed-length digests so timing reveals nothing about length/content
  const a = createHash("sha256").update(attempt).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function tooManyFailures(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginFailure)
    .where(and(eq(loginFailure.ip, ip), gt(loginFailure.at, since)));
  return n >= MAX_FAILURES;
}

export async function recordFailure(ip: string) {
  await db.insert(loginFailure).values({ ip });
  // keep the table small
  await db.delete(loginFailure).where(lt(loginFailure.at, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}

/**
 * Find (case-insensitively) or create the user for a typed name, then start a session.
 * `embedded`: the cookie also works inside another site's frame (the Mini App on
 * Telegram Web). Only the Mini App's "Parade state" asks for it (FEATURE_WHEREABOUTS);
 * the password sign-in never does.
 */
export async function startSession(name: string, { embedded = false } = {}) {
  const [existing] = await db.select().from(user).where(sql`lower(${user.name}) = lower(${name})`);
  const userId = existing?.id ?? randomUUID();
  if (existing) {
    // shared password = full access; lifts any leftover "pending" state
    const role = existing.role === "pending" ? "admin" : existing.role;
    await db.update(user).set({ lastSeenAt: new Date(), role }).where(eq(user.id, userId));
  } else {
    await db.insert(user).values({ id: userId, name, role: "admin" });
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(appSession).values({ tokenHash: sha256(token), userId, passwordTag: passwordTag(), expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    ...(embedded ? { secure: true, sameSite: "none" as const, partitioned: true } : { secure: process.env.NODE_ENV === "production", sameSite: "lax" as const }),
    path: "/",
    expires: expiresAt,
  });
}

/**
 * The signed-in user, or null — one query (session joined to user).
 * Sessions die on expiry or when the password changes.
 */
export async function sessionUser(): Promise<typeof user.$inferSelect | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ s: appSession, u: user })
    .from(appSession)
    .innerJoin(user, eq(user.id, appSession.userId))
    .where(eq(appSession.tokenHash, sha256(token)));
  if (!row || row.s.expiresAt < new Date() || row.s.passwordTag !== passwordTag()) return null;
  return row.u;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(appSession).where(eq(appSession.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
  await forgetFromTelegram(); // the Mini App's "Back to Sabre" marker; nothing with FEATURE_WHEREABOUTS off
}
