// Registration through the database: sign in with initData, find yourself on
// the roster, register. Uses sabre_test like tests/db/*; skipped if unreachable.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp } from "@/lib/db/schema";
import { wbAudit, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";

// A cookie jar standing in for next/headers, so signIn/getMember run for real.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { signIn, getMember } = await import("@/lib/wb/auth");
const { findMe, register } = await import("@/lib/wb/actions/register");

let reachable = true;
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function as(id: number, first = "Trooper") {
  jar.clear();
  await signIn({ id, first_name: first });
}

const details = { fullName: "tan ah kow", nric: "S1234567D", ord: "27/08/28", leaveLeft: "14", stayout: "NONE" as const };

describe("registration (DB)", () => {
  it("refuses an ORD date in the past, unless it's the one already stored (a reopened account)", async (ctx) => {
    if (!reachable) ctx.skip();
    await as(1009, "Ethan");
    const found = await findMe("ethan teo");
    if (!found.ok || found.data.kind !== "one") throw new Error("unreachable");
    const personId = found.data.person.personId;
    expect(await register({ personId, details: { ...details, ord: "010120" } })).toEqual({ ok: false, error: "Your ORD date can't be in the past." });
    await db.update(wbMember).set({ ordDate: "2020-01-01", registeredAt: new Date() }).where(eq(wbMember.telegramUserId, 1009));
    jar.clear();
    await as(1009, "Ethan");
    expect(await register({ personId, details: { ...details, ord: "010120" } })).toEqual({ ok: true, data: { askStatuses: true } });
  });

  it("signs in, matches a unique name and registers against the roster", async (ctx) => {
    if (!reachable) ctx.skip();
    await as(1001, "Ethan");
    const found = await findMe("ethan teo");
    expect(found).toMatchObject({ ok: true, data: { kind: "one", person: { name: "ETHAN TEO", rank: "3SG", taken: false } } });
    if (!found.ok || found.data.kind !== "one") throw new Error("unreachable");

    // on the roster and never asked: "Statuses you already have" comes next (2026-10-27)
    expect(await register({ personId: found.data.person.personId, details })).toEqual({ ok: true, data: { askStatuses: true } });
    const [m] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, 1001));
    expect(m).toMatchObject({
      personId: found.data.person.personId,
      source: "ROSTER",
      fullName: "TAN AH KOW",
      nric4: "567D", // a whole NRIC is cut to its last 4
      ordDate: "2028-08-27",
      leaveLeft: 14,
      stayout: "NONE",
    });
    expect(m.registeredAt).toBeInstanceOf(Date);
    const audits = await db.select().from(wbAudit).where(eq(wbAudit.entityId, m.id));
    expect(audits.map((a) => a.action)).toEqual(["register"]);
    expect(JSON.stringify(audits[0].after)).not.toContain("567D");
  });

  it("offers a list for 2–6 matches and asks for more past that", async (ctx) => {
    if (!reachable) ctx.skip();
    await as(1002);
    const pick = await findMe("tft present");
    expect(pick.ok && pick.data.kind).toBe("pick");
    expect(pick.ok && pick.data.kind === "pick" && pick.data.people.map((p) => p.name)).toEqual([
      "TFT PRESENT 1", "TFT PRESENT 2", "TFT PRESENT 3", "TFT PRESENT 4",
    ]);
    const tooMany = await findMe("sfta present");
    expect(tooMany).toEqual({ ok: true, data: { kind: "too-many", count: 22 } });
    expect(await findMe("nobody by this name")).toEqual({ ok: true, data: { kind: "none" } });
  });

  it("refuses a person already linked to another account", async (ctx) => {
    if (!reachable) ctx.skip();
    await as(1003);
    const found = await findMe("ETHAN TEO");
    if (!found.ok || found.data.kind !== "one") throw new Error("expected one match");
    const personId = found.data.person.personId;
    expect((await register({ personId, details })).ok).toBe(true);

    await as(1004);
    const again = await findMe("ETHAN TEO");
    expect(again.ok && again.data.kind === "one" && again.data.person.taken).toBe(true);
    const res = await register({ personId, details });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/already registered.*Ask your PS/) });

    // the owner can re-register onto the same person; once he's answered about statuses, he isn't asked again
    await db.update(wbMember).set({ statusesAskedAt: new Date() }).where(eq(wbMember.telegramUserId, 1003));
    await as(1003);
    expect(await register({ personId, details: { ...details, leaveLeft: "10" } })).toEqual({ ok: true, data: { askStatuses: false } });
  });

  it("saves a SELF sign-up when they aren't on the roster", async (ctx) => {
    if (!reachable) ctx.skip();
    const [tft] = await db.select().from(camp).where(eq(camp.name, "TFT"));
    await as(1005);
    const res = await register({
      self: { name: "new guy", campId: tft.id, role: "ST CBT", rank: "PTE" },
      details: { ...details, stayout: "TEMP", stayoutUntil: "311299" },
    });
    // not on the roster: nowhere to save a status yet, so Home asks once he's added
    expect(res).toEqual({ ok: true, data: { askStatuses: false } });
    const [m] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, 1005));
    expect(m).toMatchObject({ source: "SELF", personId: null, selfName: "NEW GUY", selfCampId: tft.id, stayout: "TEMP", stayoutUntil: "2099-12-31" });

    // HQ roles don't fit a guardroom
    const bad = await register({ self: { name: "x y", campId: tft.id, role: "OC", rank: "PTE" }, details });
    expect(bad).toEqual({ ok: false, error: "Pick a role that fits that camp." });
  });

  it("rejects bad details with readable messages", async (ctx) => {
    if (!reachable) ctx.skip();
    await as(1006);
    const found = await findMe("TFT PRESENT 2");
    if (!found.ok || found.data.kind !== "one") throw new Error("expected one match");
    const res = await register({
      personId: found.data.person.personId,
      details: { fullName: "ok name", nric: "1234", ord: "310228", leaveLeft: "abc", stayout: "TEMP", stayoutUntil: "010120" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/NRIC/);
    expect(res.error).toMatch(/ORD/);
    expect(res.error).toMatch(/Leave left/);
    expect(res.error).toMatch(/stay-out can't be in the past/);
  });

  it("makes WB_ADMIN_TELEGRAM_IDS admins on sign-in, and a deactivated member is signed out", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "2001");
    await as(2001);
    const admin = await getMember();
    expect(admin?.grants).toEqual([{ role: "ADMIN", subunitId: null, campId: null }]);
    await as(2001); // signing in again doesn't duplicate the grant
    expect(await db.select().from(wbGrant)).toHaveLength(1);

    await db.update(wbMember).set({ active: false }).where(eq(wbMember.telegramUserId, 2001));
    expect(await getMember()).toBeNull();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  });
});
