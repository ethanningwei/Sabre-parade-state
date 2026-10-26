// The Mini App's "Parade state": signing a commander in to the v1 web app by
// name. Uses sabre_test; skipped if unreachable.

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { appSession, person, user } from "@/lib/db/schema";
import { wbAudit, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const jar = new Map<string, string>();
/** The attributes of the last Set-Cookie for each name (a clearing one too) */
const attrs = new Map<string, Record<string, unknown>>();
/** Cookies the browser also sends but this response never set: an older session, say */
const extraSent: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown> = {}) => {
      attrs.set(name, opts);
      if (opts.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ cookie: [...[...jar].map(([k, v]) => `${k}=${v}`), ...extraSent].join("; ") }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { signIn } = await import("@/lib/wb/auth");
const { openParadeState } = await import("@/lib/wb/actions/parade");
const { fromTelegram, FROM_TG_COOKIE } = await import("@/lib/wb/from-telegram");
const { endSession, sessionUser, SESSION_COOKIE } = await import("@/lib/session");
const { PROJECTOR_USER } = await import("@/lib/wb/projection");

const PROJECTOR = PROJECTOR_USER.name;
const TG_ONLY = "ZZTEST PARADE NOROSTER";

let reachable = true;
let gcPerson: typeof person.$inferSelect;
let v1Name: string;
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  vi.stubEnv("APP_PASSWORD", "local-test-only");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [gcPerson] = await db.select().from(person).where(eq(person.active, true)).limit(1);
  v1Name = `${gcPerson.rank} ${gcPerson.name}`.toUpperCase();
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  attrs.clear();
  extraSent.length = 0;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
  await dropUsers([v1Name, TG_ONLY]);
});
afterAll(async () => {
  if (reachable) await dropUsers([v1Name, TG_ONLY]);
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function dropUsers(names: string[]) {
  const lower = names.map((n) => n.toLowerCase());
  const ids = (await db.select({ id: user.id }).from(user).where(inArray(sql`lower(${user.name})`, lower))).map((u) => u.id);
  if (!ids.length) return;
  await db.delete(appSession).where(inArray(appSession.userId, ids));
  await db.delete(user).where(inArray(user.id, ids));
}

/** A registered member with these grants, signed in to the Mini App. */
async function memberWith(telegramUserId: number, grants: Partial<typeof wbGrant.$inferInsert>[], extra: Partial<typeof wbMember.$inferInsert> = {}) {
  const [m] = await db.insert(wbMember).values({ telegramUserId, tgName: `T${telegramUserId}`, registeredAt: new Date(), ...extra }).returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: "GC", ...g });
  jar.clear();
  await signIn({ id: telegramUserId, first_name: extra.tgName ?? `T${telegramUserId}` });
  return m;
}

const usersNamed = (name: string) => db.select().from(user).where(sql`lower(${user.name}) = lower(${name})`);

describe("open the parade state (DB)", () => {
  it("signs a GC in to v1 as RANK NAME, with both cookies and an audit row", async (ctx) => {
    if (!reachable) ctx.skip();
    const m = await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });

    expect(await openParadeState()).toEqual({ ok: true, data: { name: v1Name, path: "/" } });
    expect((await sessionUser())?.name).toBe(v1Name);
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
    expect(jar.get(FROM_TG_COOKIE)).toBe("1");
    expect(await fromTelegram()).toBe(true);

    const [u] = await usersNamed(v1Name);
    expect(u).toMatchObject({ role: "admin", active: true });
    const audits = await db.select().from(wbAudit).where(eq(wbAudit.action, "open-parade-state"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ memberId: m.id, via: "MINIAPP", entity: "user", entityId: u.id, after: { name: v1Name } });

    // v1's sign-out ends both
    await endSession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(FROM_TG_COOKIE)).toBe(false);
    expect(await sessionUser()).toBeNull();
  });

  it("Telegram Web: both cookies work inside another site's frame; the password sign-in's cookie is unchanged", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    await openParadeState();
    const embedded = { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/" };
    expect(attrs.get(SESSION_COOKIE)).toMatchObject(embedded);
    expect(attrs.get(FROM_TG_COOKIE)).toMatchObject(embedded);

    // v1's own sign-in (the password form) still sets SameSite=Lax, unpartitioned
    attrs.clear();
    const { startSession } = await import("@/lib/session");
    await startSession(TG_ONLY);
    expect(attrs.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(attrs.get(SESSION_COOKIE)).not.toHaveProperty("partitioned");
  });

  it("signing out of a Mini App session ends every session the browser sent and clears both cookies the embedded way", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    // an older, unpartitioned session from before 2026-10-19 sits beside today's
    await openParadeState();
    const older = jar.get(SESSION_COOKIE)!;
    await openParadeState();
    extraSent.push(`${SESSION_COOKIE}=${older}`);
    const [u] = await usersNamed(v1Name);
    expect(await db.select().from(appSession).where(eq(appSession.userId, u.id))).toHaveLength(2);

    await endSession();
    expect(await db.select().from(appSession).where(eq(appSession.userId, u.id))).toEqual([]);
    for (const name of [SESSION_COOKIE, FROM_TG_COOKIE]) expect(attrs.get(name)).toMatchObject({ sameSite: "none", partitioned: true, secure: true, maxAge: 0 });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(FROM_TG_COOKIE)).toBe(false);
  });

  it("a dead password sign-in's cookie sent beside the Mini App's doesn't sign them out", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    // signed in with the shared password, which has since been removed
    vi.stubEnv("APP_PASSWORD", "an-old-password");
    const { startSession } = await import("@/lib/session");
    await startSession(v1Name);
    const stale = jar.get(SESSION_COOKIE)!;
    vi.stubEnv("APP_PASSWORD", "");
    expect(await sessionUser()).toBeNull();

    await openParadeState();
    // the browser sends both; cookies().get can hand back the dead one
    extraSent.push(`${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)}`);
    jar.set(SESSION_COOKIE, stale);
    expect((await sessionUser())?.name).toBe(v1Name);
  });

  it("lands on the v1 screen asked for, and only on a v1 screen", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    expect(await openParadeState(`/c/${gcPerson.campId}`)).toMatchObject({ ok: true, data: { path: `/c/${gcPerson.campId}` } });
    expect(await openParadeState("/parade")).toMatchObject({ ok: true, data: { path: "/parade" } });
    for (const bad of ["https://evil.example", "//evil.example", "/tg", "/admin/people", "/c/not-a-camp"]) {
      expect(await openParadeState(bad)).toMatchObject({ ok: true, data: { path: "/" } });
    }
  });

  it("reuses a v1 user who typed the same name", async (ctx) => {
    if (!reachable) ctx.skip();
    await db.insert(user).values({ id: "zztest-typed", name: v1Name.toLowerCase(), role: "guardcomm", subunitId: null });
    await memberWith(1, [{ role: "PS", subunitId: null, campId: null }], { personId: gcPerson.id });

    expect(await openParadeState()).toMatchObject({ ok: true });
    const rows = await usersNamed(v1Name);
    expect(rows.map((r) => r.id)).toEqual(["zztest-typed"]);
    expect((await sessionUser())?.id).toBe("zztest-typed");
  });

  it("falls back to the Telegram name with no roster person", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "OC" }], { tgName: "zztest  parade noroster" });
    expect(await openParadeState()).toEqual({ ok: true, data: { name: TG_ONLY, path: "/" } });
    expect((await sessionUser())?.name).toBe(TG_ONLY);
  });

  it("refuses a trooper, an ASA and a non-member, and signs nobody in", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [], { personId: gcPerson.id });
    expect(await openParadeState()).toEqual({ ok: false, error: expect.stringMatching(/^Only GCs, PSs, PCs/) });

    await memberWith(2, [{ role: "ASA" }]);
    expect(await openParadeState()).toMatchObject({ ok: false });

    jar.clear();
    expect(await openParadeState()).toEqual({ ok: false, error: "Please reopen Sabre from Telegram." });

    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(FROM_TG_COOKIE)).toBe(false);
    expect(await usersNamed(v1Name)).toHaveLength(0);
    expect(await db.select().from(wbAudit).where(eq(wbAudit.action, "open-parade-state"))).toHaveLength(0);
  });

  it("refuses a name switched off in v1", async (ctx) => {
    if (!reachable) ctx.skip();
    await db.insert(user).values({ id: "zztest-off", name: v1Name, active: false });
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    expect(await openParadeState()).toEqual({ ok: false, error: expect.stringContaining("switched off in the parade state") });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect((await usersNamed(v1Name))[0].active).toBe(false);
  });

  it("never signs in, creates or wakes the projector's user", async (ctx) => {
    if (!reachable) ctx.skip();
    const before = await usersNamed(PROJECTOR);
    await memberWith(1, [{ role: "ADMIN" }], { tgName: PROJECTOR });
    expect(await openParadeState()).toEqual({ ok: false, error: "That name is reserved. Ask an admin." });
    await memberWith(2, [{ role: "ADMIN" }], { tgName: ` sabre   (WHEREABOUTS) ` });
    expect(await openParadeState()).toMatchObject({ ok: false });
    expect(await usersNamed(PROJECTOR)).toEqual(before);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("is a 404 with the flag off, and v1 never sees or clears the marker", async (ctx) => {
    if (!reachable) ctx.skip();
    await memberWith(1, [{ role: "GC", campId: gcPerson.campId }], { personId: gcPerson.id });
    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    await expect(openParadeState()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await usersNamed(v1Name)).toHaveLength(0);

    jar.set(FROM_TG_COOKIE, "1");
    expect(await fromTelegram()).toBe(false);
    await endSession();
    expect(jar.get(FROM_TG_COOKIE)).toBe("1");
  });
});
