// v1's attendance and duty actions through the database: what setStatus,
// setCampShift, saveDuty and endDuty write (absences, duties, the "RF @ X"
// home absence, audit rows) and what they refuse. Written before their bodies
// were extracted into plain cores for the whereabouts projector, so the
// extraction is held to "no behaviour change"; the last block checks the
// cores (lib/core) write exactly what the actions do. Uses sabre_test; skipped
// if unreachable.

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
const { setStatusCore, setCampShiftCore } = await import("@/lib/core/attendance");
const { saveDutyCore, endDutyCore } = await import("@/lib/core/duties");

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

describe("savePerson and removePerson", () => {
  const byName = async (campIdValue: string, name: string) =>
    (await db.select().from(person).where(and(eq(person.campId, campIdValue), eq(person.name, name), eq(person.active, true))))[0];

  it("creates at the end of the camp, edits in place, and a move re-sorts into the new camp", async (ctx) => {
    if (!reachable) ctx.skip();
    const { savePerson } = await import("@/lib/actions/admin");
    const last = (await db.select({ s: person.sortOrder }).from(person).where(eq(person.campId, ids.tft)).orderBy(asc(person.sortOrder))).at(-1)!.s;
    expect(await savePerson({ campId: ids.tft, rank: " pte ", name: " new  man ", role: "ST CBT" })).toEqual({ ok: true, data: undefined });
    const made = await byName(ids.tft, "NEW  MAN");
    expect(made).toMatchObject({ rank: "PTE", role: "ST CBT", sortOrder: last + 1, active: true });

    await savePerson({ personId: made.id, campId: ids.tft, rank: "LCP", name: "NEW  MAN", role: "GC" });
    expect((await db.select().from(person).where(eq(person.id, made.id)))[0]).toMatchObject({ rank: "LCP", role: "GC", sortOrder: last + 1 });

    const bdkLast = (await db.select({ s: person.sortOrder }).from(person).where(eq(person.campId, ids.bdk)).orderBy(asc(person.sortOrder))).at(-1)!.s;
    await savePerson({ personId: made.id, campId: ids.bdk, rank: "LCP", name: "NEW  MAN", role: "GC" });
    expect((await db.select().from(person).where(eq(person.id, made.id)))[0]).toMatchObject({ campId: ids.bdk, sortOrder: bdkLast + 1 });
    expect(await auditActions()).toEqual(["create-person:person", "update-person:person", "update-person:person"]);
  });

  it("refuses a duplicate name in a camp and a person who isn't there", async (ctx) => {
    if (!reachable) ctx.skip();
    const { savePerson } = await import("@/lib/actions/admin");
    const [t1] = await db.select().from(person).where(eq(person.id, p.t1));
    expect(await savePerson({ campId: ids.tft, rank: "PTE", name: t1.name, role: "" })).toEqual({ ok: false, error: `'${t1.name}' is already in that camp. Add a surname to tell them apart.` });
    expect(await savePerson({ personId: "00000000-0000-4000-8000-000000000000", campId: ids.tft, rank: "PTE", name: "X", role: "" })).toEqual({ ok: false, error: "Person not found." });
    expect(await auditActions()).toEqual([]);
  });

  it("removePerson: inactive, open absences closed by the admin, one audit row", async (ctx) => {
    if (!reachable) ctx.skip();
    const { removePerson } = await import("@/lib/actions/admin");
    await setStatus({ ...mc, personIds: [p.t1], otherReason: "", startTime: null, endTime: null, maTiming: "", maLocation: "" });
    expect(await removePerson(p.t1)).toEqual({ ok: true, data: undefined });
    expect((await db.select().from(person).where(eq(person.id, p.t1)))[0].active).toBe(false);
    expect(await openOf(p.t1)).toBeUndefined();
    expect((await absencesOf(p.t1))[0].closedBy).toBe(ADMIN);
    const rows = await db.select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.userId, ADMIN), eq(auditLog.action, "remove-person")));
    expect(rows).toEqual([{ action: "remove-person", after: { active: false } }]);
  });
});

describe("the cores write exactly what the actions write", () => {
  const blank = { otherReason: "", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "" };
  // a row with what's bound to differ (ids, the person, clocks) left out
  const shape = <T extends Record<string, unknown>>(row: T | undefined) => {
    if (!row) return row;
    const rest: Record<string, unknown> = { ...row, closed: row.closedAt != null, linked: row.dutyId != null };
    for (const k of ["id", "personId", "createdAt", "closedAt", "dutyId", "rank", "name", "sortOrder"]) delete rest[k];
    return rest;
  };
  const history = async (personId: string) => (await absencesOf(personId)).map(shape);

  it("setStatus: open, edit, replace, present", async (ctx) => {
    if (!reachable) ctx.skip();
    const steps = [
      { ...blank, ...mc, startTime: "0800" },
      { ...blank, ...mc, endDate: "2026-10-16" },
      { ...blank, status: "OTHERS" as const, otherReason: "Course" },
      { ...blank, status: "PRESENT" as const },
    ];
    for (const step of steps) {
      expect((await setStatus({ ...step, personIds: [p.t1] })).ok).toBe(true);
      await db.transaction((tx) => setStatusCore(tx, ADMIN, { ...step, personIds: [p.t2] }));
    }
    expect(await history(p.t2)).toEqual(await history(p.t1));
    const actions = await auditActions();
    expect(actions.filter((_, i) => i % 2 === 1)).toEqual(actions.filter((_, i) => i % 2 === 0));
  });

  it("setCampShift", async (ctx) => {
    if (!reachable) ctx.skip();
    await setCampShift(ids.tft, false);
    const { before, after } = await db.transaction((tx) => setCampShiftCore(tx, ADMIN, ids.bdk, false));
    expect([before.onShift, after.onShift]).toEqual([true, false]);
    const rows = await db.select({ action: auditLog.action, before: auditLog.before, after: auditLog.after }).from(auditLog).where(eq(auditLog.userId, ADMIN)).orderBy(asc(auditLog.at));
    expect(rows[1]).toEqual(rows[0]);
  });

  it("saveDuty and endDuty: create, edit, end, with the home absence", async (ctx) => {
    if (!reachable) ctx.skip();
    const base = { rank: "", name: "", campId: ids.bdk, startTime: null, endTime: null };
    const viaAction = (await saveDuty({ type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-15" })) as { data: string };
    const viaCore = await db.transaction((tx) => saveDutyCore(tx, ADMIN, { ...base, type: "RF", personId: p.t2, startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-15" }));
    const duties = async () => [
      shape((await db.select().from(duty).where(eq(duty.id, viaAction.data)))[0]),
      shape((await db.select().from(duty).where(eq(duty.id, viaCore.id)))[0]),
    ];
    let [a, b] = await duties();
    expect(b).toEqual(a);
    expect(await history(p.t2)).toEqual(await history(p.t1));

    await saveDuty({ id: viaAction.data, type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-13", endDate: "2026-10-18" });
    await db.transaction((tx) => saveDutyCore(tx, ADMIN, { ...base, id: viaCore.id, type: "RF", personId: p.t2, startDate: "2026-10-13", endDate: "2026-10-18" }));
    [a, b] = await duties();
    expect(b).toEqual(a);
    expect(await history(p.t2)).toEqual(await history(p.t1));

    await endDuty(viaAction.data);
    await db.transaction((tx) => endDutyCore(tx, ADMIN, viaCore.id));
    [a, b] = await duties();
    expect(b).toEqual(a);
    expect(await history(p.t2)).toEqual(await history(p.t1));
    expect(await auditActions()).toEqual(["create-duty:duty", "create-duty:duty", "update-duty:duty", "update-duty:duty", "end-duty:duty", "end-duty:duty"]);
  });

  it("savePerson and removePerson: create, edit, move, remove", async (ctx) => {
    if (!reachable) ctx.skip();
    const { savePerson, removePerson } = await import("@/lib/actions/admin");
    const { savePersonCore, removePersonCore } = await import("@/lib/core/people");
    const strip = (r: typeof person.$inferSelect) => ({ campId: r.campId, rank: r.rank, role: r.role, active: r.active });
    const find = async (name: string) => (await db.select().from(person).where(and(eq(person.name, name), eq(person.active, true))))[0];
    await savePerson({ campId: ids.tft, rank: "PTE", name: "VIA ACTION", role: "ST CBT" });
    const core = await savePersonCore(db, ADMIN, { campId: ids.tft, rank: "PTE", name: "VIA CORE", role: "ST CBT" });
    const action = await find("VIA ACTION");
    expect(strip(core)).toEqual(strip(action));
    expect(core.sortOrder).toBe(action.sortOrder + 1);
    await savePerson({ personId: action.id, campId: ids.bdk, rank: "LCP", name: "VIA ACTION", role: "GC" });
    await savePersonCore(db, ADMIN, { personId: core.id, campId: ids.bdk, rank: "LCP", name: "VIA CORE", role: "GC" });
    const [a2, c2] = [await find("VIA ACTION"), await find("VIA CORE")];
    expect(strip(c2)).toEqual(strip(a2));
    expect(c2.sortOrder).toBe(a2.sortOrder + 1);
    await removePerson(action.id);
    await db.transaction((tx) => removePersonCore(tx, ADMIN, core.id));
    expect((await db.select().from(person).where(eq(person.id, core.id)))[0].active).toBe(false);
    const actions = await auditActions();
    expect(actions).toEqual(["create-person:person", "create-person:person", "update-person:person", "update-person:person", "remove-person:person", "remove-person:person"]);
    await expect(savePersonCore(db, ADMIN, { campId: ids.tft, rank: "PTE", name: (await db.select().from(person).where(eq(person.id, p.t2)))[0].name, role: "" })).rejects.toThrow("is already in that camp");
  });

  it("the cores refuse what the actions refuse", async (ctx) => {
    if (!reachable) ctx.skip();
    const [sftA1] = await db.select({ id: person.id }).from(person).where(and(eq(person.campId, ids.sftA), eq(person.active, true)));
    await expect(db.transaction((tx) => setStatusCore(tx, ADMIN, { ...blank, ...mc, personIds: [sftA1.id] }))).rejects.toThrow("SFT A is off shift");
    await expect(
      db.transaction((tx) => saveDutyCore(tx, ADMIN, { type: "RF", rank: "", name: "", personId: p.t1, campId: ids.tft, startDate: "2026-10-13", startTime: null, endDate: "2026-10-14", endTime: null })),
    ).rejects.toThrow("can't be served at their own team (TFT)");
  });
});

describe("Admin › People › Remove and whereabouts (FEATURE_WHEREABOUTS)", () => {
  const setUp = async () => {
    const { wbAudit, wbGrant, wbMember } = await import("@/lib/wb/db/schema");
    // earlier DB test files (projection, records, register) leave wb_audit rows behind
    await db.delete(wbAudit);
    const [m] = await db.insert(wbMember).values({ telegramUserId: 990001, tgName: "T", registeredAt: new Date(), personId: p.t1 }).returning();
    await db.insert(wbGrant).values({ memberId: m.id, role: "PS", subunitId: ids.pl5 });
    const d = await saveDuty({ type: "RF", personId: p.t1, campId: ids.bdk, startDate: "2026-10-13", endDate: "2026-10-15" });
    return { m, dutyId: (d as { data: string }).data };
  };
  const tearDown = async () => {
    const { wbAudit, wbGrant, wbMember } = await import("@/lib/wb/db/schema");
    await db.delete(wbGrant);
    await db.delete(wbMember).where(eq(wbMember.telegramUserId, 990001));
    await db.delete(wbAudit);
    vi.unstubAllEnvs();
  };

  it("off: v1 alone, exactly as before (his account and grant untouched, his open duty left open)", async (ctx) => {
    if (!reachable) ctx.skip();
    const { removePerson } = await import("@/lib/actions/admin");
    const { wbAudit, wbGrant, wbMember } = await import("@/lib/wb/db/schema");
    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    try {
      const { m, dutyId } = await setUp();
      expect(await removePerson(p.t1)).toEqual({ ok: true, data: undefined });
      expect((await db.select().from(wbMember).where(eq(wbMember.id, m.id)))[0].active).toBe(true);
      expect(await db.select().from(wbGrant).where(eq(wbGrant.memberId, m.id))).toHaveLength(1);
      expect((await db.select().from(duty).where(eq(duty.id, dutyId)))[0].closedAt).toBeNull();
      expect(await db.select().from(wbAudit)).toEqual([]);
    } finally {
      await tearDown();
    }
  });

  it("on: the same cleanup as the Mini App's, audited as from the web app", async (ctx) => {
    if (!reachable) ctx.skip();
    const { removePerson } = await import("@/lib/actions/admin");
    const { wbAudit, wbGrant, wbMember } = await import("@/lib/wb/db/schema");
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    try {
      const { m, dutyId } = await setUp();
      expect(await removePerson(p.t1)).toEqual({ ok: true, data: undefined });
      expect((await db.select().from(wbMember).where(eq(wbMember.id, m.id)))[0].active).toBe(false);
      expect(await db.select().from(wbGrant).where(eq(wbGrant.memberId, m.id))).toEqual([]);
      expect((await db.select().from(duty).where(eq(duty.id, dutyId)))[0]).toMatchObject({ closedBy: ADMIN });
      const rows = await db.select({ action: wbAudit.action, via: wbAudit.via, after: wbAudit.after }).from(wbAudit).where(eq(wbAudit.action, "remove-from-roster"));
      expect(rows).toEqual([{ action: "remove-from-roster", via: "WEB", after: expect.objectContaining({ by: "v1 test admin", grants: 1, duties: 1 }) }]);
    } finally {
      await tearDown();
    }
  });
});
