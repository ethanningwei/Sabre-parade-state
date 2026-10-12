import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ForbiddenError } from "@/lib/authz";
import { db } from "@/lib/db";
import { wbGrant, wbMember, type WbRole } from "@/lib/wb/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { hasGrant, type GrantRow, type GrantScope } from "@/lib/wb/domain/grants";

// Mini App sign-in. Telegram signs `initData` with the bot token; we check it,
// then hand out our own stateless cookie so later requests don't need it.
// Nothing here touches the v1 password session.

export const WB_SESSION_COOKIE = "wb_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

// ------------------------------------------------------------------ initData

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TgUser;
  authDate: number;
  startParam: string | null;
}

/**
 * Checks Telegram's signature on Mini App initData
 * (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   secret = HMAC_SHA256(key "WebAppData", bot token)
 *   hash   = hex(HMAC_SHA256(key secret, data-check-string))
 * where the data-check-string is every field but `hash`, sorted, "k=v" joined
 * by \n. Returns null for anything tampered, unsigned, stale (> 24 h) or
 * without a user.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedInitData | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;

  const check = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate)) return null;
  // stale, or (allowing for clock skew) from the future
  if (nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS || authDate - nowSeconds > 300) return null;

  let user: TgUser;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { user, authDate, startParam: params.get("start_param") };
}

// ------------------------------------------------------------------ session cookie

export interface WbSession {
  /** wb_member.id */
  mid: string;
  /** Telegram user id: a member row recreated for another account can't inherit the cookie */
  tg: number;
  /** expiry, unix seconds */
  exp: number;
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set (use: openssl rand -base64 32)");
  return s;
}

// a separate key from v1's uses of AUTH_SECRET, so a value signed for one can't pass as the other
const sessionMac = (body: string, secret: string) =>
  createHmac("sha256", `wb-session:${secret}`).update(body).digest("base64url");

export function signSession(s: WbSession, secret = authSecret()): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${sessionMac(body, secret)}`;
}

export function verifySession(
  token: string | undefined,
  secret = authSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
): WbSession | null {
  if (!token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sessionMac(body, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as WbSession;
    if (typeof s.mid !== "string" || typeof s.tg !== "number" || typeof s.exp !== "number") return null;
    return s.exp > nowSeconds ? s : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ grants

export { grantCovers, hasGrant, type GrantRow, type GrantScope } from "@/lib/wb/domain/grants";

/** WB_ADMIN_TELEGRAM_IDS: comma-separated Telegram user ids that are always ADMIN. */
export function bootstrapAdminIds(): number[] {
  return (process.env.WB_ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

// ------------------------------------------------------------------ server side

export type Member = typeof wbMember.$inferSelect & { grants: GrantRow[] };

const tgDisplayName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 100);

/**
 * Called by POST /api/wb/auth with verified initData: find or create the
 * member, make bootstrap admins ADMIN, and set the cookie.
 */
export async function signIn(user: TgUser): Promise<typeof wbMember.$inferSelect> {
  const [member] = await db
    .insert(wbMember)
    .values({ telegramUserId: user.id, tgUsername: user.username ?? null, tgName: tgDisplayName(user) })
    .onConflictDoUpdate({
      target: wbMember.telegramUserId,
      set: { tgUsername: user.username ?? null, tgName: tgDisplayName(user), lastSeenAt: new Date() },
    })
    .returning();

  // The env list is authoritative: to take ADMIN away from a bootstrap admin,
  // take them out of WB_ADMIN_TELEGRAM_IDS too.
  if (bootstrapAdminIds().includes(user.id)) {
    const added = await db
      .insert(wbGrant)
      .values({ memberId: member.id, role: "ADMIN" })
      .onConflictDoNothing()
      .returning({ id: wbGrant.id });
    if (added.length) {
      await wbAudit(db, { memberId: member.id, via: "SYSTEM", action: "bootstrap-admin", entity: "wb_grant", entityId: added[0].id });
    }
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  (await cookies()).set(WB_SESSION_COOKIE, signSession({ mid: member.id, tg: user.id, exp }), {
    httpOnly: true,
    // the Mini App runs in Telegram Web's iframe, a third-party context
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return member;
}

/** The signed-in member with their grants, or null. Re-read each request so deactivation and grant changes apply at once. */
export const getMember = cache(async (): Promise<Member | null> => {
  const session = verifySession((await cookies()).get(WB_SESSION_COOKIE)?.value);
  if (!session) return null;
  const rows = await db
    .select({ m: wbMember, g: { role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId } })
    .from(wbMember)
    .leftJoin(wbGrant, eq(wbGrant.memberId, wbMember.id))
    .where(and(eq(wbMember.id, session.mid), eq(wbMember.telegramUserId, session.tg)));
  if (!rows.length || !rows[0].m.active) return null;
  return { ...rows[0].m, grants: rows.flatMap((r) => (r.g?.role ? [r.g as GrantRow] : [])) };
});

/**
 * For Mini App pages. With no session the layout is already showing the
 * sign-in bootstrap, so send the page back to the root it will refresh.
 */
export async function requireMember(): Promise<Member> {
  const m = await getMember();
  if (!m) redirect("/tg");
  return m;
}

/** For pages past registration. */
export async function requireRegistered(): Promise<Member> {
  const m = await requireMember();
  if (!m.registeredAt) redirect("/tg/register");
  return m;
}

/** For pages: lacking the grant sends them Home. */
export async function requireGrantPage(roles: readonly WbRole[], scope: GrantScope = "any"): Promise<Member> {
  const m = await requireRegistered();
  if (!hasGrant(m.grants, roles, scope)) redirect("/tg");
  return m;
}

/** For server actions: throws ForbiddenError, which `run()` turns into a message. */
export async function requireGrant(roles: readonly WbRole[], scope: GrantScope = "any"): Promise<Member> {
  const m = await getMember();
  if (!m) throw new ForbiddenError("Please reopen Sabre from Telegram.");
  if (!hasGrant(m.grants, roles, scope)) throw new ForbiddenError("You don't have permission to do that.");
  return m;
}

/** For server actions that any signed-in member may call. */
export async function actionMember(): Promise<Member> {
  const m = await getMember();
  if (!m) throw new ForbiddenError("Please reopen Sabre from Telegram.");
  return m;
}
