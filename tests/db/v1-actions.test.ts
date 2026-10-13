// v1's attendance and duty actions through the database: what setStatus,
// setCampShift, saveDuty and endDuty write (absences, duties, the "RF @ X"
// home absence, audit rows) and what they refuse. Written before their bodies
// were extracted into plain cores for the whereabouts projector, so the
// extraction is held to "no behaviour change". Uses sabre_test; skipped if
// unreachable.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, auditLog, camp, duty, person, subunit, user } from "@/lib/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: "admin" | "guardcomm" | "pending"; subunitId: string | null; active: boolean } }));
vi.mock("@/lib/session", () => ({ sessionUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setStatus, setCampShift } = await import("@/lib/actions/attendance");
const { saveDuty, endDuty } = await import("@/lib/actions/duties");

const ADMIN = "v1-test-admin";
const GC = "v1-test-gc";

let reachable = true;
const ids = { tft: "", bdk: "", sftA: "", pl5: "" };
const p: Record<string, string> = {};

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
  }
});
beforeEach(async () => {
  if (!reachable) return;
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  const subId = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
  ids.tft = await campId("TFT");
  ids.bdk = await campId("BDK");
  ids.sftA = await campId("SFT A");
  ids.pl5 = await subId("PLATOON 5");
  const at = async (campIdValue: string) =>
    (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, campIdValue), eq(person.active, true))).orderBy(asc(person.sortOrder))).map((r) => r.id);
  const tft = await at(ids.tft);
  const bdk = await at(ids.bdk);
  // people with no absence in the example, so each test starts them PRESENT
  const present = async (list: string[]) => {
    const open = new Set((await db.select({ id: absence.personId }).from(absence).where(and(inArray(absence.personId, list), isNull(absence.closedAt)))).map((r) => r.id));
    return list.filter((id) => !open.has(id));
  };
  [p.t1, p.t2, p.t3] = await present(tft);
  [p.b1, p.b2] = await present(bdk);
  await db.delete(auditLog).where(inArray(auditLog.userId, [ADMIN, GC]));
  await db
    .insert(user)
    .values([
      { id: ADMIN, name: "v1 test admin", role: "admin" },
      { id: GC, name: "v1 test gc", role: "guardcomm", subunitId: ids.pl5 },
    ])
    .onConflictDoUpdate({ target: user.id, set: { active: true } });
  await db.update(user).set({ subunitId: ids.pl5 }).where(eq(user.id, GC));
  session.user = { id: ADMIN, name: "v1 test admin", role: "admin", subunitId: null, active: true };
});
afterAll(async () => {
  if (reachable) {
    await db.delete(auditLog).where(inArray(auditLog.userId, [ADMIN, GC]));
    await db.delete(user).where(inArray(user.id, [ADMIN, GC]));
  }
  await db.$client.end();
});

const absencesOf = (personId: string) =>
  db.select().from(absence).where(eq(absence.personId, personId)).orderBy(asc(absence.createdAt));
const openOf = async (personId: string) =>
  (await db.select().from(absence).where(and(eq(absence.personId, personId), isNull(absence.closedAt))))[0];
const auditActions = async () =>
  (await db.select({ action: auditLog.action, entity: auditLog.entity }).from(auditLog).where(eq(auditLog.userId, ADMIN)).orderBy(asc(auditLog.at))).map(
    (r) => `${r.action}:${r.entity}`,
  );
const mc = { status: "MC" as const, startDate: "2026-10-13", endDate: "2026-10-14" };

describe("setStatus", () => {
  it("opens an absence for each person, normalising the fields per type", async (ctx) => {
    if (!reachable) ctx.skip();
    expect(await setStatus({ personIds: [p.t1, p.t2], ...mc, startTime: "0800", maTiming: "ignored", otherReason: "ignored" })).toEqual({ ok: true, data: undefined });
    for (const id of [p.t1, p.t2]) {
      expect(await openOf(id)).toMatchObject({
        type: "MC",
        startDate: "2026-10-13",
        startTime: "0800",
        endDate: "2026-10-14",
        endTime: null,
        otherReason: "",
        maTiming: "",
        maLocation: "",
        createdBy: ADMIN,
        dutyId: null,
      });
    }
    await setStatus({ personIds: [p.t3], status: "MA", startDate: "2026-10-13", endDate: "2026-10-20", endTime: "1200", maTiming: " 1300 ", maLocation: " KTPH " });
    expect(await openOf(p.t3)).toMatchObject({ type: "MA", startDate: "2026-10-13", endDate: null, endTime: null, maTiming: "1300", maLocation: "KTPH" });
    expect(await auditActions()).toEqual(["set-absence:absence", "set-absence:absence", "set-absence:absence"]);
  });

  it("edits the same type in place, replaces a different type, and PRESENT closes it", async (ctx) => {
    if (!reachable) ctx.skip();
    await setStatus({ personIds: [p.t1], ...mc });
    const first = await openOf(p.t1);
    await setStatus({ personIds: [p.t1], ...mc, endDate: "2026-10-16" });
    expect(await openOf(p.t1)).toMatchObject({ id: first.id, endDate: "2026-10-16" });

    await setStatus({ personIds: [p.t1], status: "OTHERS", otherReason: " Course ", startDate: null, endDate: null });
    const all = await absencesOf(p.t1);
    expect(all.map((a) => [a.type, a.closedAt ? "closed" : "open", a.closedBy])).toEqual([
      ["MC", "closed", ADMIN],
      ["OTHERS", "open", null],
    ]);
    expect(all[1]).toMatchObject({ otherReason: "Course", startDate: null, startTime: null, endDate: null });

    await setStatus({ personIds: [p.t1, p.t2], status: "PRESENT" }); // t2 had nothing open: skipped
    expect(await openOf(p.t1)).toBeUndefined();
    expect(await absencesOf(p.t2)).toEqual([]);
    expect(await auditActions()).toEqual(["set-absence:absence", "update-absence:absence", "set-absence:absence", "mark-present:absence"]);
  });

  it("refuses what v1 refuses, writing nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const [sftA1] = await db.select({ id: person.id }).from(person).where(and(eq(person.campId, ids.sftA), eq(person.active, true)));
    const cases: [Parameters<typeof setStatus>[0], string][] = [
      [{ personIds: [sftA1.id], ...mc }, "SFT A is off shift. Put it on shift to update attendance."],
      [{ personIds: [p.t1], status: "AL", startDate: "2026-10-13" }, "AL needs a start and end date."],
      [{ personIds: [p.t1], status: "MA" }, "MA needs a timing, e.g. 1300."],
      [{ personIds: [p.t1], status: "OTHERS", otherReason: "  " }, "Please give the reason."],
      [{ personIds: [p.t1], ...mc, startDate: "2026-10-14", endDate: "2026-10-13" }, "The end is before the start."],
      [{ personIds: [p.t1], ...mc, startTime: "0900", endDate: "2026-10-13", endTime: "0800" }, "The end is before the start."],
      [{ personIds: [], ...mc }, "Pick at least one person"],
    ];
    for (const [input, error] of cases) expect(await setStatus(input)).toEqual({ ok: false, error });
    expect(await absencesOf(p.t1)).toEqual([]);

    // a guardcomm of BDK's platoon can't touch TFT's people
    const subOf = async (id: string) => (await db.select({ s: camp.subunitId }).from(camp).where(eq(camp.id, id)))[0].s;
    expect(await subOf(ids.tft)).not.toBe(await subOf(ids.bdk));
    session.user = { id: GC, name: "v1 test gc", role: "guardcomm", subunitId: await subOf(ids.bdk), active: true };
    expect(await setStatus({ personIds: [p.t1], ...mc })).toEqual({ ok: false, error: "You can only edit your own platoon." });
    expect((await setStatus({ personIds: [p.b1], ...mc })).ok).toBe(true);
    session.user = null;
    expect(await setStatus({ personIds: [p.t1], ...mc })).toEqual({ ok: false, error: "Please sign in again." });
  });
});

describe("setCampShift", () => {
  it("flips on_shift and audits it with the value before", async (ctx) => {
    if (!reachable) ctx.skip();
    expect(await setCampShift(ids.tft, false)).toEqual({ ok: true, data: undefined });
    expect((await db.select({ on: camp.onShift }).from(camp).where(eq(camp.id, ids.tft)))[0].on).toBe(false);
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.userId, ADMIN), eq(auditLog.entityId, ids.tft)));
    expect(row).toMatchObject({ action: "shift-off", entity: "camp", before: { onShift: true }, after: { onShift: false } });
    expect(await setCampShift("not-a-uuid", true)).toMatchObject({ ok: false });
  });
});

describe("saveDuty and endDuty", () => {
  it("an RF for a roster man writes the duty and his 'RF @ X' home absence; edits follow; end closes both", async (ctx) => {
    if (!reachable) ctx.skip();
    const r = await saveDuty({ type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-15" });
    expect(r.ok).toBe(true);
    const dutyId = (r as { data: string }).data;
    const [d] = await db.select().from(duty).where(eq(duty.id, dutyId));
    const [t1] = await db.select().from(person).where(eq(person.id, p.t1));
    expect(d).toMatchObject({ type: "RF", rank: t1.rank, name: t1.name, personId: p.t1, campId: ids.bdk, startTime: "2100", createdBy: ADMIN, closedAt: null });
    expect(await openOf(p.t1)).toMatchObject({ type: "OTHERS", otherReason: "RF @ BDK", dutyId, startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-15", createdBy: ADMIN });

    await saveDuty({ id: dutyId, type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-13", endDate: "2026-10-18" });
    expect(await openOf(p.t1)).toMatchObject({ dutyId, endDate: "2026-10-18", startTime: null });

    // moved to another man: the first man's home absence closes, the second gets one
    await saveDuty({ id: dutyId, type: "RF", personId: p.t2, campId: ids.bdk, startDate: "2026-10-13", endDate: "2026-10-18" });
    expect(await openOf(p.t1)).toBeUndefined();
    expect(await openOf(p.t2)).toMatchObject({ dutyId, otherReason: "RF @ BDK" });

    expect(await endDuty(dutyId)).toEqual({ ok: true, data: undefined });
    expect((await db.select().from(duty).where(eq(duty.id, dutyId)))[0]).toMatchObject({ closedBy: ADMIN });
    expect(await openOf(p.t2)).toBeUndefined();
    expect(await auditActions()).toEqual(["create-duty:duty", "update-duty:duty", "update-duty:duty", "end-duty:duty"]);
  });

  it("keeps a man's real absence instead of an 'RF @' one; SOL serves at home; an Extra by name has no home absence", async (ctx) => {
    if (!reachable) ctx.skip();
    await setStatus({ personIds: [p.t3], ...mc });
    const extra = await saveDuty({ type: "EXTRA", personId: p.t3, campId: ids.bdk, startDate: "2026-10-13", endDate: "2026-10-14" });
    expect(extra.ok).toBe(true);
    expect(await openOf(p.t3)).toMatchObject({ type: "MC", dutyId: null });

    const sol = await saveDuty({ type: "SOL", personId: p.b1, campId: ids.tft, startDate: "2026-10-13", endDate: "2026-10-20" });
    const [solRow] = await db.select().from(duty).where(eq(duty.id, (sol as { data: string }).data));
    expect(solRow.campId).toBe(ids.bdk);
    expect(await openOf(p.b1)).toBeUndefined();

    const named = await saveDuty({ type: "EXTRA", rank: "CPL", name: "OUTSIDER", campId: ids.tft, startDate: "2026-10-13", endDate: "2026-10-13" });
    const [namedRow] = await db.select().from(duty).where(eq(duty.id, (named as { data: string }).data));
    expect(namedRow).toMatchObject({ rank: "CPL", name: "OUTSIDER", personId: null, campId: ids.tft });
    expect(namedRow.sortOrder).toBeGreaterThanOrEqual(0);
  });

  it("refuses what v1 refuses", async (ctx) => {
    if (!reachable) ctx.skip();
    const base = { startDate: "2026-10-13", endDate: "2026-10-14" };
    const cases: [Parameters<typeof saveDuty>[0], string][] = [
      [{ type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-14", endDate: "2026-10-13" }, "The end is before the start."],
      [{ type: "RF", personId: p.t1, campId: ids.tft, ...base }, "RF can't be served at their own team (TFT). Pick another camp."],
      [{ type: "RF", personId: p.t1, ...base }, "Pick the camp they're serving at."],
      [{ type: "SOL", rank: "PTE", name: "X", ...base }, "Pick the person from the roster: SOL is served with their own camp."],
      [{ type: "EXTRA", campId: ids.tft, ...base }, "Rank and name are required."],
    ];
    for (const [input, error] of cases) expect(await saveDuty(input)).toEqual({ ok: false, error });
    await db.update(person).set({ active: false }).where(eq(person.id, p.t2));
    expect(await saveDuty({ type: "RF", personId: p.t2, campId: ids.bdk, ...base })).toEqual({ ok: false, error: "That person is no longer on the roster." });
    await db.update(person).set({ active: true }).where(eq(person.id, p.t2));
  });
});
