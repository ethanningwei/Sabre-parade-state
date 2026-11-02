// The parade state opened from the Mini App edits only the men in the
// member's own parade-state reach (the user, 2026-11-02): a GC his camp, a PS
// or PC his platoon, OC/2IC/CSM and ADMIN the whole coy. Uses sabre_test;
// skipped if unreachable.

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { appSession, camp, person, subunit, user } from "@/lib/db/schema";
import { wbAudit, wbGrant, wbMember, wbParadeSession } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown> = {}) => {
      if (opts.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { signIn } = await import("@/lib/wb/auth");
const { openParadeState } = await import("@/lib/wb/actions/parade");
const { getViewer } = await import("@/lib/authz");
const { setCampShift, setStatus } = await import("@/lib/actions/attendance");
const { updateCoySettings } = await import("@/lib/actions/admin");
const { startSession } = await import("@/lib/session");

const NAMES = ["ZZTEST SCOPE GC", "ZZTEST SCOPE PS", "ZZTEST SCOPE OC"];

let reachable = true;
const ids = { tft: "", hdn: "", bdk: "", pl5: "", tftMan: "", hdnMan: "", bdkMan: "" };
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  const manAt = async (campIdValue: string) => (await db.select({ id: person.id }).from(person).where(eq(person.campId, campIdValue)).limit(1))[0].id;
  ids.tft = await campId("TFT");
  ids.hdn = await campId("HDN");
  ids.bdk = await campId("BDK");
  ids.pl5 = (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 5")))[0].id;
  ids.tftMan = await manAt(ids.tft);
  ids.hdnMan = await manAt(ids.hdn);
  ids.bdkMan = await manAt(ids.bdk);
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("APP_PASSWORD", "local-test-only");
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
  await dropUsers();
});
afterAll(async () => {
  if (reachable) await dropUsers();
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function dropUsers() {
  const found = await db.select({ id: user.id }).from(user).where(inArray(sql`lower(${user.name})`, NAMES.map((n) => n.toLowerCase())));
  if (!found.length) return;
  const userIds = found.map((u) => u.id);
  await db.delete(appSession).where(inArray(appSession.userId, userIds));
  await db.delete(user).where(inArray(user.id, userIds));
}

/** A member with these grants opens the parade state from the Mini App. */
async function opens(telegramUserId: number, tgName: string, grants: Partial<typeof wbGrant.$inferInsert>[]) {
  const [m] = await db.insert(wbMember).values({ telegramUserId, tgName, registeredAt: new Date() }).returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: "GC", ...g });
  jar.clear();
  await signIn({ id: telegramUserId, first_name: tgName });
  expect(await openParadeState()).toMatchObject({ ok: true });
  return m;
}

/** On-shift there and back: a write the camp's own commander may make. */
async function toggles(campId: string) {
  const off = await setCampShift(campId, false);
  if (off.ok) await setCampShift(campId, true);
  return off;
}

const refused = (error: string) => ({ ok: false, error });

describe("the parade state's reach (DB)", () => {
  it("a GC edits his own camp's men only, not another camp's in his platoon or another platoon's", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);

    expect(await getViewer()).toMatchObject({ role: "guardcomm", subunitId: null, scope: { subunitIds: [], campIds: [ids.tft] } });
    expect(await toggles(ids.tft)).toMatchObject({ ok: true });
    expect(await toggles(ids.hdn)).toEqual(refused("You can only edit your own camp."));
    expect(await setStatus({ personIds: [ids.hdnMan], status: "OFF" })).toEqual(refused("You can only edit your own camp."));
    expect(await setStatus({ personIds: [ids.tftMan, ids.bdkMan], status: "OFF" })).toEqual(refused("You can only edit your own camp."));
    // nothing was written for the man in reach either: the check runs first
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from absence where person_id = ${ids.tftMan} and type = 'OFF' and closed_at is null`).then((r) => r.rows);
    expect(n).toBe(0);
  });

  it("a PS edits his whole platoon, and nothing outside it", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(2, "zztest scope ps", [{ role: "PS", subunitId: ids.pl5 }]);

    expect(await getViewer()).toMatchObject({ role: "guardcomm", subunitId: ids.pl5 });
    expect(await toggles(ids.tft)).toMatchObject({ ok: true });
    expect(await toggles(ids.hdn)).toMatchObject({ ok: true });
    expect(await toggles(ids.bdk)).toEqual(refused("You can only edit your own platoon."));
  });

  it("without the whole coy, v1's Admin is closed", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(2, "zztest scope ps", [{ role: "PS", subunitId: ids.pl5 }]);
    expect(await updateCoySettings({ displayName: "X", telegramChatId: "", telegramThreadId: "" })).toEqual(refused("Only admins can do that."));
  });

  it("OC (and ADMIN) reach the whole coy: an admin, as before", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(3, "zztest scope oc", [{ role: "OC" }]);
    const viewer = await getViewer();
    expect(viewer).toMatchObject({ role: "admin" });
    expect(viewer?.scope).toBeUndefined();
    expect(await toggles(ids.bdk)).toMatchObject({ ok: true });
  });

  it("a grant taken away applies at once; a switched-off member can only view", async (ctx) => {
    if (!reachable) ctx.skip();
    const m = await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);
    await db.delete(wbGrant).where(eq(wbGrant.memberId, m.id));
    expect(await toggles(ids.tft)).toEqual(refused("You can only view the parade state."));

    await db.insert(wbGrant).values({ memberId: m.id, role: "GC", campId: ids.tft });
    await db.update(wbMember).set({ active: false }).where(eq(wbMember.id, m.id));
    expect(await toggles(ids.tft)).toEqual(refused("You can only view the parade state."));
  });

  it("the shared-password sign-in keeps full access", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);
    jar.clear();
    await startSession("ZZTEST SCOPE GC");
    expect(await getViewer()).toMatchObject({ role: "admin" });
    expect(await toggles(ids.bdk)).toMatchObject({ ok: true });
  });

  it("with the password sign-in off, a session from before this change is scoped by who last opened it", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("APP_PASSWORD", "");
    await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);
    await db.delete(wbParadeSession);
    expect(await getViewer()).toMatchObject({ role: "guardcomm", scope: { campIds: [ids.tft] } });
    expect(await toggles(ids.bdk)).toEqual(refused("You can only edit your own camp."));
  });

  it("with the flag off, v1 is unchanged", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);
    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    const viewer = await getViewer();
    expect(viewer).toMatchObject({ role: "admin" });
    expect(viewer?.scope).toBeUndefined();
  });

  it("v1's sign-out takes the session's owner with it", async (ctx) => {
    if (!reachable) ctx.skip();
    await opens(1, "zztest scope gc", [{ role: "GC", campId: ids.tft }]);
    expect(await db.select().from(wbParadeSession)).toHaveLength(1);
    const { endSession } = await import("@/lib/session");
    await endSession();
    expect(await db.select().from(wbParadeSession)).toHaveLength(0);
  });
});
