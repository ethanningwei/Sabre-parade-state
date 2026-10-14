// The projector through the database: shadow mode writes nothing; live, the
// timeline reaches v1 (loadSnapshot) through the v1 cores, a GC's own entry is
// never overwritten, an ended MC waits for "Back", a void closes, a deploy is a
// v1 duty with its home absence, stand down ends it, a HOTO flips on_shift,
// and switching projection off leaves ordinary v1 rows. Uses sabre_test.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setStatusCore } from "@/lib/core/attendance";
import { writeCoy } from "@/lib/data/write-coy";
import { getCoyByKey, loadSnapshot } from "@/lib/data/snapshot";
import { db } from "@/lib/db";
import { absence, auditLog, camp, duty, person, user } from "@/lib/db/schema";
import { sgtToInstant } from "@/lib/parade/time";
import { wbAssignment, wbAudit, wbMember, wbProjection, wbRecord, wbShiftEvent, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import { WEEKDAYS } from "@/lib/wb/domain/shifts";
import { exampleSnapshot } from "../fixtures/example-snapshot";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: "admin"; subunitId: null; active: boolean } }));
vi.mock("@/lib/session", () => ({ sessionUser: async () => session.user }));
const { PROJECTOR_USER, syncProjection } = await import("@/lib/wb/projection");
const { currentSnapshot } = await import("@/lib/data/current");
const { generateParadeState } = await import("@/lib/actions/parade");
const { inTx } = await import("@/lib/wb/core");
const { confirmBack, dueBack, paradeStatuses } = await import("@/lib/wb/projection");
const { eveningRound } = await import("@/lib/wb/evening");
const { recordingCourier } = await import("./recording-courier");
const { revertedSince, projectionReport } = await import("@/lib/wb/projection");
const { keepShift } = await import("@/lib/wb/shifts");
const { setCampShiftCore } = await import("@/lib/core/attendance");

const at = (date: string, time = "0000") => sgtToInstant({ date, time });
const NOW = at("2026-10-14", "1000");
const GC = "projection-test-gc";
const TG = 770001;

let reachable = true;
const ids = { tft: "", bdk: "", sftA: "", sftB: "" };
let t1 = "";
let t2 = "";
let s1 = ""; // in SFT A, off shift

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
  }
});
beforeEach(async () => {
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("FEATURE_PROJECTION", "");
  await db.delete(wbProjection);
  await db.delete(wbMember).where(eq(wbMember.telegramUserId, TG));
  await db.delete(wbAssignment);
  await db.delete(wbShiftEvent);
  await db.delete(wbShiftOverride);
  await db.delete(wbShiftPattern);
  await db.delete(wbRecord);
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  ids.tft = await campId("TFT");
  ids.bdk = await campId("BDK");
  ids.sftA = await campId("SFT A");
  ids.sftB = await campId("SFT B");
  const first = async (campIdValue: string, n = 1) =>
    (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, campIdValue), eq(person.active, true))).orderBy(person.sortOrder)).slice(0, n).map((r) => r.id);
  [t1, t2] = await first(ids.tft, 2);
  [s1] = await first(ids.sftA);
  await db.insert(user).values({ id: GC, name: "projection test gc", role: "admin" }).onConflictDoNothing();
  await db.delete(user).where(eq(user.id, PROJECTOR_USER.id)); // so each test sees whether it's created
});
afterAll(async () => {
  if (reachable) {
    await db.delete(wbProjection);
    await db.delete(auditLog).where(inArray(auditLog.userId, [GC, PROJECTOR_USER.id]));
    await db.delete(user).where(eq(user.id, GC));
  }
  vi.unstubAllEnvs();
  await db.$client.end();
});

const live = () => vi.stubEnv("FEATURE_PROJECTION", "1");
const record = async (o: Partial<typeof wbRecord.$inferInsert> & Pick<typeof wbRecord.$inferInsert, "kind" | "personId">) =>
  (
    await db
      .insert(wbRecord)
      .values({ state: "APPROVED", absent: true, startAt: at("2026-10-13"), endAt: at("2026-10-16"), createdVia: "SELF", detail: o.kind, ...o })
      .returning()
  )[0];
const openOf = async (personId: string) => (await db.select().from(absence).where(and(eq(absence.personId, personId), isNull(absence.closedAt))))[0];
const snapshotAbsence = async (personId: string) =>
  (await loadSnapshot(await getCoyByKey("SABRE"))).subunits.flatMap((s) => s.camps.flatMap((c) => c.people)).find((p) => p.id === personId)?.absence ?? null;
const v1Counts = async () => ({
  absences: (await db.select({ id: absence.id }).from(absence)).length,
  open: (await db.select({ id: absence.id }).from(absence).where(isNull(absence.closedAt))).length,
  duties: (await db.select({ id: duty.id }).from(duty).where(isNull(duty.closedAt))).length,
  onShift: (await db.select({ id: camp.id }).from(camp).where(eq(camp.onShift, true))).length,
  audit: (await db.select({ id: auditLog.id }).from(auditLog)).length,
});

describe("the Mini App's 'on the parade state?'", () => {
  it("says on, or why not; nothing while projection is off", async (ctx) => {
    if (!reachable) ctx.skip();
    const day = 86_400_000;
    const t = Date.now();
    const al = await record({ kind: "AL", personId: t1, startAt: new Date(t - day), endAt: new Date(t + day) });
    expect((await paradeStatuses([al])).size).toBe(0);

    live();
    await db.transaction((tx) =>
      setStatusCore(tx, GC, { personIds: [t2], status: "OTHERS", otherReason: "COURSE", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "" }),
    );
    const off = await record({ kind: "OFF", personId: t2, startAt: new Date(t - day), endAt: new Date(t + day) });
    const later = await record({ kind: "OL", personId: t1, startAt: new Date(t + 3 * day), endAt: new Date(t + 5 * day) });
    const ma = await record({ kind: "MA", personId: t1, state: "RECORDED", startAt: new Date(t - day), endAt: new Date(t + day), maTiming: "1300" });
    const got = await paradeStatuses([al, off, later, ma]);
    expect(got.get(al.id)).toEqual({ on: true });
    expect(got.get(off.id)).toEqual({ on: false, why: "the GC has him as COURSE" });
    expect(got.get(later.id)).toEqual({ on: false, why: "goes on when it starts" });
    expect(got.get(ma.id)).toEqual({ on: false, why: "his other record shows instead" });
  });
});

describe("Back?", () => {
  it("lists what ends before the next round; only his GC, PC or PS can confirm; it closes once it has ended", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await record({ kind: "MC", personId: t1, state: "RECORDED", startAt: at("2026-10-12"), endAt: at("2026-10-15") });
    await record({ kind: "AL", personId: t2, startAt: at("2026-10-13"), endAt: at("2026-10-20") });
    await syncProjection(NOW);
    const due = await dueBack(at("2026-10-15", "1000"));
    expect(due.map((d) => [d.personId, d.what])).toEqual([[t1, "MC"]]);

    const [m] = await db.insert(wbMember).values({ telegramUserId: TG, registeredAt: new Date() }).returning();
    const tftSub = (await db.select({ s: camp.subunitId }).from(camp).where(eq(camp.id, ids.tft)))[0].s;
    const bdkGc = { id: m.id, personId: null, grants: [{ role: "GC" as const, subunitId: null, campId: ids.bdk }] };
    expect(await confirmBack(bdkGc, due[0].projectionId, "BOT")).toMatchObject({ ok: false });
    const ps = { id: m.id, personId: null, grants: [{ role: "PS" as const, subunitId: tftSub, campId: null }] };
    // confirmed the evening before: noted, still MC until it ends (syncs run at the real time, long after)
    await db.update(wbRecord).set({ endAt: new Date(Date.now() + 86_400_000) }).where(eq(wbRecord.personId, t1));
    await syncProjection(new Date());
    const [pending] = await dueBack(new Date(Date.now() + 2 * 86_400_000));
    expect(await confirmBack(ps, pending.projectionId, "BOT")).toMatchObject({ ok: true, closed: false });
    expect(await openOf(t1)).toMatchObject({ type: "MC" });
    expect(await dueBack(new Date(Date.now() + 2 * 86_400_000))).toEqual([]);
    // once it has ended, the next sync closes it
    await syncProjection(new Date(Date.now() + 2 * 86_400_000));
    expect(await openOf(t1)).toBeUndefined();
  });

  it("an MC extended after Back needs a new Back", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    const mc = await record({ kind: "MC", personId: t1, state: "RECORDED", startAt: at("2026-10-12"), endAt: at("2026-10-15") });
    await syncProjection(NOW);
    await db.update(wbProjection).set({ backConfirmedAt: NOW });
    await db.update(wbRecord).set({ endAt: at("2026-10-18") }).where(eq(wbRecord.id, mc.id));
    await syncProjection(NOW);
    expect((await db.select().from(wbProjection))[0].backConfirmedAt).toBeNull();
    await syncProjection(at("2026-10-19"));
    expect(await openOf(t1)).toMatchObject({ type: "MC", endDate: "2026-10-17" });
  });

  it("the evening round: Back? to the platoon when on, the shadow diff to the admins when off", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "1");
    await record({ kind: "AL", personId: t1, startAt: at("2026-10-13"), endAt: at("2026-10-15") });
    const shadow = recordingCourier();
    expect(await eveningRound(shadow, at("2026-10-14", "1900"), { force: true })).toMatchObject({ back: 0, projection: 1 });
    const diff = shadow.sent.find((x) => "send" in x && "admins" in x.send);
    expect(diff && "text" in diff && diff.text).toMatch(/^🔍 Shadow diff[\s\S]*TFT\n• .*: \+ AL 13\/10–14\/10/);
    expect(await openOf(t1)).toBeUndefined();

    live();
    const on = recordingCourier();
    const res = await eveningRound(on, at("2026-10-14", "1900"), { force: true });
    expect(res).toMatchObject({ back: 1, projection: 1 });
    const back = on.sent.find((x) => "send" in x && x.text.startsWith("🏠 Back?"));
    expect(back && "buttons" in back && back.buttons?.[0][0].text).toMatch(/^✅ .* back$/);
    expect(back && "text" in back && back.text).toContain("AL to 14/10");
    expect(await openOf(t1)).toMatchObject({ type: "AL" });
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  });
});

describe("shadow mode (FEATURE_PROJECTION off)", () => {
  it("plans the writes and writes nothing to v1", async (ctx) => {
    if (!reachable) ctx.skip();
    const al = await record({ kind: "AL", personId: t1 });
    await db.insert(wbShiftEvent).values({ campId: ids.sftA, at: at("2026-10-14", "0900"), on: true, matched: true });
    const before = await v1Counts();
    const res = await syncProjection(NOW);
    expect(res.live).toBe(false);
    expect(res.plan.writes.map((w) => w.op).sort()).toEqual(["absence", "shift", "shift"]);
    expect(res.plan.writes.find((w) => w.op === "absence")).toMatchObject({ personId: t1, recordId: al.id, why: "open" });
    expect(await v1Counts()).toEqual(before);
    expect(await db.select().from(wbProjection)).toEqual([]);
    expect(await db.select().from(user).where(eq(user.id, PROJECTOR_USER.id))).toHaveLength(0);
  });
});

describe("live (FEATURE_PROJECTION on)", () => {
  it("an approved AL opens a v1 absence the parade state shows; a second sync changes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    const al = await record({ kind: "AL", personId: t1 });
    const res = await syncProjection(NOW);
    expect(res).toMatchObject({ live: true, busy: false, applied: 1, failed: [] });
    expect(await openOf(t1)).toMatchObject({ type: "AL", startDate: "2026-10-13", endDate: "2026-10-15", createdBy: PROJECTOR_USER.id });
    expect(await snapshotAbsence(t1)).toMatchObject({ type: "AL" });
    const [p] = await db.select().from(wbProjection);
    expect(p).toMatchObject({ kind: "ABSENCE", recordId: al.id, personId: t1, closedAt: null });
    const again = await syncProjection(NOW);
    expect(again.plan).toEqual({ writes: [], marks: [], notes: [] });
    // the projector's v1 user can't be used to sign in and act
    expect((await db.select().from(user).where(eq(user.id, PROJECTOR_USER.id)))[0]).toMatchObject({ active: false, role: "pending" });
  });

  it("never overwrites a GC's own absence", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await db.transaction((tx) =>
      setStatusCore(tx, GC, { personIds: [t1], status: "OTHERS", otherReason: "COURSE", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "" }),
    );
    await record({ kind: "AL", personId: t1 });
    const res = await syncProjection(NOW);
    expect(res.applied).toBe(0);
    expect(res.plan.notes).toMatchObject([{ op: "conflict", personId: t1, want: "AL", has: "COURSE" }]);
    expect(await openOf(t1)).toMatchObject({ type: "OTHERS", otherReason: "COURSE", createdBy: GC });
  });

  it("an ended MC stays open until Back is confirmed; a void closes at once", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await record({ kind: "MC", personId: t1, state: "RECORDED", startAt: at("2026-10-12"), endAt: at("2026-10-14", "0900") });
    await syncProjection(at("2026-10-13", "1000"));
    expect(await openOf(t1)).toMatchObject({ type: "MC", endDate: "2026-10-14", endTime: "0900" });

    const later = await syncProjection(NOW);
    expect(later.plan.notes).toMatchObject([{ op: "due-back", personId: t1, what: "MC" }]);
    expect(await openOf(t1)).toBeDefined();
    await db.update(wbProjection).set({ backConfirmedAt: NOW });
    expect((await syncProjection(NOW)).applied).toBe(1);
    expect(await openOf(t1)).toBeUndefined();
    expect((await db.select().from(wbProjection))[0]).toMatchObject({ close: "BACK" });

    const al = await record({ kind: "AL", personId: t2 });
    await syncProjection(NOW);
    expect(await openOf(t2)).toMatchObject({ type: "AL" });
    await db.update(wbRecord).set({ state: "CANCELLED" }).where(eq(wbRecord.id, al.id));
    await syncProjection(NOW);
    expect(await openOf(t2)).toBeUndefined();
  });

  it("lets go of a row a GC closed, and doesn't reopen it", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await record({ kind: "AL", personId: t1 });
    await syncProjection(NOW);
    await db.transaction((tx) =>
      setStatusCore(tx, GC, { personIds: [t1], status: "PRESENT", otherReason: "", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "" }),
    );
    const res = await syncProjection(NOW);
    expect(res.applied).toBe(0);
    expect(await openOf(t1)).toBeUndefined();
    expect((await db.select().from(wbProjection))[0]).toMatchObject({ close: "BY_HAND" });
    expect((await syncProjection(NOW)).plan.writes).toEqual([]);
  });

  it("a deploy is a v1 duty with its 'RF @ X' home absence; stand down ends both", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    const [a] = await db
      .insert(wbAssignment)
      .values({ personId: t1, type: "RF", campId: ids.bdk, startAt: at("2026-10-13", "2100"), endAt: at("2026-10-16", "2100") })
      .returning();
    await syncProjection(NOW);
    const [d] = await db.select().from(duty).where(and(eq(duty.personId, t1), isNull(duty.closedAt)));
    expect(d).toMatchObject({ type: "RF", campId: ids.bdk, startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-16", endTime: "2100", createdBy: PROJECTOR_USER.id });
    expect(await openOf(t1)).toMatchObject({ type: "OTHERS", otherReason: "RF @ BDK", dutyId: d.id });

    await db.update(wbAssignment).set({ state: "CANCELLED" }).where(eq(wbAssignment.id, a.id));
    await syncProjection(NOW);
    expect((await db.select().from(duty).where(eq(duty.id, d.id)))[0].closedAt).not.toBeNull();
    expect(await openOf(t1)).toBeUndefined();
  });

  it("a HOTO flips on_shift for the pair, and v1's off-shift lock waits instead of failing", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await record({ kind: "AL", personId: s1 });
    const first = await syncProjection(NOW);
    expect(first.plan.notes).toMatchObject([{ op: "waiting", personId: s1, reason: "SFT A is off shift" }]);
    expect(await openOf(s1)).toBeUndefined();

    await db.insert(wbShiftEvent).values({ campId: ids.sftA, at: at("2026-10-14", "0900"), on: true, matched: true });
    const res = await syncProjection(NOW);
    expect(res.failed).toEqual([]);
    const shifts = await db.select({ id: camp.id, on: camp.onShift }).from(camp).where(inArray(camp.id, [ids.sftA, ids.sftB]));
    expect(Object.fromEntries(shifts.map((s) => [s.id === ids.sftA ? "A" : "B", s.on]))).toEqual({ A: true, B: false });
    expect(await openOf(s1)).toMatchObject({ type: "AL" });
    // the HOTO is settled: the next sync leaves on_shift to the GCs
    await db.update(camp).set({ onShift: false }).where(eq(camp.id, ids.sftA));
    expect((await syncProjection(NOW)).plan.writes.filter((w) => w.op === "shift")).toEqual([]);
  });

  it("runs before the web app shows or generates a parade state, and after a whereabouts write", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    // records in force right now, since these callers sync at the real time
    const today = new Date();
    const day = 86_400_000;
    await record({ kind: "AL", personId: t1, startAt: new Date(today.getTime() - day), endAt: new Date(today.getTime() + day) });
    const snap = await currentSnapshot();
    expect(snap.subunits.flatMap((s) => s.camps.flatMap((c) => c.people)).find((p) => p.id === t1)?.absence?.type).toBe("AL");

    await record({ kind: "OFF", personId: t2, startAt: new Date(today.getTime() - day), endAt: new Date(today.getTime() + day) });
    session.user = { id: GC, name: "projection test gc", role: "admin", subunitId: null, active: true };
    await generateParadeState({ date: "2026-10-14", time: "1000" });
    expect(await openOf(t2)).toMatchObject({ type: "OFF" });

    const [t3] = (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, ids.tft), eq(person.active, true))).orderBy(person.sortOrder)).slice(2).map((r) => r.id);
    await record({ kind: "OL", personId: t3, startAt: new Date(today.getTime() - day), endAt: new Date(today.getTime() + day) });
    expect(await inTx(async () => "done")).toEqual({ ok: true, value: "done" });
    expect(await openOf(t3)).toMatchObject({ type: "OL" });
  });

  it("does none of that while projection is off", async (ctx) => {
    if (!reachable) ctx.skip();
    const today = new Date();
    await record({ kind: "AL", personId: t1, startAt: new Date(today.getTime() - 86_400_000), endAt: new Date(today.getTime() + 86_400_000) });
    const before = await v1Counts();
    await currentSnapshot();
    await inTx(async () => null);
    expect(await v1Counts()).toEqual(before);
  });

  it("switched off again, its rows are ordinary v1 rows the GCs carry on with", async (ctx) => {
    if (!reachable) ctx.skip();
    live();
    await record({ kind: "AL", personId: t1 });
    await syncProjection(NOW);
    vi.stubEnv("FEATURE_PROJECTION", "");
    const before = await v1Counts();
    expect((await syncProjection(NOW)).live).toBe(false);
    expect(await v1Counts()).toEqual(before);
    await db.transaction((tx) =>
      setStatusCore(tx, GC, { personIds: [t1], status: "AL", otherReason: "", startDate: "2026-10-13", startTime: null, endDate: "2026-10-20", endTime: null, maTiming: "", maLocation: "" }),
    );
    expect(await openOf(t1)).toMatchObject({ type: "AL", endDate: "2026-10-20" });
  });
});

describe("weekday camps (2026-10-14)", () => {
  const SAT = at("2026-10-17", "0900");
  const onShift = async (campId: string) => (await db.select({ on: camp.onShift }).from(camp).where(eq(camp.id, campId)))[0].on;

  it("off at the weekend, a GC's toggle switched back, an admin's override kept, on again on Monday", async (ctx) => {
    if (!reachable) ctx.skip();
    await db.delete(wbAudit).where(eq(wbAudit.action, "revert-shift"));
    await db.insert(wbShiftPattern).values({ campId: ids.bdk, kind: "WEEKLY", weekdayMask: WEEKDAYS, holidaysOff: true });
    await db.update(camp).set({ onShift: true }).where(eq(camp.id, ids.bdk));
    live();
    await syncProjection(at("2026-10-16", "1200"));
    expect(await onShift(ids.bdk)).toBe(true);

    const res = await syncProjection(SAT);
    expect(res.failed).toEqual([]);
    expect(await onShift(ids.bdk)).toBe(false);
    const [row] = await db.select().from(wbProjection).where(and(eq(wbProjection.kind, "SHIFT"), eq(wbProjection.campId, ids.bdk), isNull(wbProjection.closedAt)));
    expect(row.wrote).toEqual({ on: false });

    // a GC switches it on in the web app: the next sync switches it back, and the admins hear of it
    await db.transaction((tx) => setCampShiftCore(tx, GC, ids.bdk, true));
    await syncProjection(at("2026-10-17", "1000"));
    expect(await onShift(ids.bdk)).toBe(false);
    const reverted = await revertedSince(new Date(0));
    expect(reverted).toEqual([expect.objectContaining({ campId: ids.bdk, on: false })]);
    expect(await projectionReport({ plan: { writes: [], marks: [], notes: [] }, live: true, applied: 0, failed: [] }, new Date(0))).toContain("BDK was switched on in the web app; back off");

    // only an admin overrides; kept on for the rest of the weekend
    vi.stubEnv("FEATURE_PROJECTION", ""); // keepShift's own sync would run at the real time
    const [m] = await db.insert(wbMember).values({ telegramUserId: TG, registeredAt: new Date() }).returning();
    const gc = { id: m.id, personId: null, grants: [{ role: "GC" as const, subunitId: null, campId: ids.bdk }] };
    expect(await keepShift(gc, ids.bdk, true, "MINIAPP", SAT)).toMatchObject({ ok: false });
    const admin = { id: m.id, personId: null, grants: [{ role: "ADMIN" as const, subunitId: null, campId: null }] };
    expect(await keepShift(admin, ids.bdk, true, "MINIAPP", SAT)).toMatchObject({ ok: true });
    live();
    await syncProjection(at("2026-10-18", "1000"));
    expect(await onShift(ids.bdk)).toBe(true);
    expect((await db.select().from(wbAudit).where(eq(wbAudit.action, "revert-shift"))).length).toBe(1);

    // Monday: the override is over and the pattern says on anyway
    await syncProjection(at("2026-10-19", "0700"));
    expect(await onShift(ids.bdk)).toBe(true);
  });
});
