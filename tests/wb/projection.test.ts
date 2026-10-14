import { describe, expect, it } from "vitest";
import { sgtToInstant } from "@/lib/parade/time";
import {
  absenceRow,
  absenceValues,
  dutyRow,
  dutyValues,
  planProjection,
  v1End,
  type PAssignment,
  type PCamp,
  type PlanInput,
  type PProjection,
  type PRecord,
  type V1Absence,
  type V1Duty,
} from "@/lib/wb/domain/projection";

const at = (date: string, time = "0000") => sgtToInstant({ date, time });
const NOW = at("2026-10-14", "1000");

const camps: PCamp[] = [
  { id: "sftA", name: "SFT A", post: "SFT", subunitId: "pl5", onShift: true },
  { id: "sftB", name: "SFT B", post: "SFT", subunitId: "pl5", onShift: false },
  { id: "bdk", name: "BDK", post: "BDK", subunitId: "pl6", onShift: true },
];
const homeOf = new Map([
  ["p1", "sftA"],
  ["p2", "sftA"],
  ["p3", "sftB"],
  ["p4", "bdk"],
]);

let n = 0;
const rec = (o: Partial<PRecord> & Pick<PRecord, "kind">): PRecord => ({
  id: `r${++n}`,
  personId: "p1",
  state: "APPROVED",
  absent: true,
  startAt: at("2026-10-13"),
  endAt: at("2026-10-16"),
  detail: o.kind,
  location: "",
  maTiming: null,
  ...o,
});
const asg = (o: Partial<PAssignment> = {}): PAssignment => ({
  id: `a${++n}`,
  personId: "p1",
  type: "RF",
  campId: "bdk",
  startAt: at("2026-10-13", "2100"),
  endAt: at("2026-10-16", "2100"),
  state: "ACTIVE",
  ...o,
});
const v1abs = (o: Partial<V1Absence> = {}): V1Absence => ({
  id: `abs${++n}`,
  personId: "p1",
  type: "AL",
  otherReason: "",
  startDate: "2026-10-13",
  startTime: null,
  endDate: "2026-10-15",
  endTime: null,
  maTiming: "",
  maLocation: "",
  dutyId: null,
  ...o,
});
const proj = (o: Partial<PProjection>): PProjection => ({
  id: `pj${++n}`,
  kind: "ABSENCE",
  personId: "p1",
  recordId: null,
  assignmentId: null,
  absenceId: null,
  dutyId: null,
  closedAt: null,
  close: null,
  backConfirmedAt: null,
  wrote: null,
  ...o,
});
/** a v1 absence exactly as the projector would have written it for r, and its projection */
const ours = (r: PRecord, extra: Partial<PProjection> = {}) => {
  const row = absenceRow(absenceValues(r)!);
  const a = v1abs({ personId: r.personId, ...row });
  return { a, p: proj({ personId: r.personId, recordId: r.id, absenceId: a.id, wrote: row, ...extra }) };
};
const plan = (o: Partial<PlanInput>) =>
  planProjection({ now: NOW, records: [], assignments: [], shiftEvents: [], absences: [], duties: [], camps, homeOf, projections: [], ...o });

describe("mapping a record to v1", () => {
  it("dates: a date range ends the day before its exclusive midnight, with no times", () => {
    expect(absenceValues(rec({ kind: "MC" }))).toEqual({
      status: "MC",
      otherReason: "",
      startDate: "2026-10-13",
      startTime: null,
      endDate: "2026-10-15",
      endTime: null,
      maTiming: "",
      maLocation: "",
    });
    expect(v1End(at("2026-10-16", "2100"))).toEqual({ date: "2026-10-16", time: "2100" });
    expect(absenceValues(rec({ kind: "OFF", startAt: at("2026-10-13", "2100") }))).toMatchObject({ startTime: "2100" });
  });

  it("MA is one day with its timing and place; an event is OTHERS with its detail", () => {
    expect(absenceValues(rec({ kind: "MA", state: "RECORDED", startAt: at("2026-10-14"), endAt: at("2026-10-15"), maTiming: "1300", location: "KTPH" }))).toEqual({
      status: "MA",
      otherReason: "",
      startDate: "2026-10-14",
      startTime: null,
      endDate: null,
      endTime: null,
      maTiming: "1300",
      maLocation: "KTPH",
    });
    expect(absenceValues(rec({ kind: "EVENT", detail: "DV DRIVER COURSE @ MAJU CAMP" }))).toMatchObject({ status: "OTHERS", otherReason: "DV DRIVER COURSE @ MAJU CAMP" });
  });

  it("RSI, RSO, STATUS and anything not away are never projected", () => {
    for (const kind of ["RSI", "RSO", "STATUS"] as const) expect(absenceValues(rec({ kind }))).toBeNull();
    expect(absenceValues(rec({ kind: "EVENT", absent: false }))).toBeNull();
  });

  it("an assignment: v1 duty dates, SOL at his own camp", () => {
    expect(dutyValues(asg(), "sftA")).toEqual({
      type: "RF",
      rank: "",
      name: "",
      personId: "p1",
      campId: "bdk",
      startDate: "2026-10-13",
      startTime: "2100",
      endDate: "2026-10-16",
      endTime: "2100",
    });
    expect(dutyValues(asg({ type: "SOL", campId: "bdk" }), "sftA").campId).toBe("sftA");
  });
});

describe("planning absences", () => {
  it("opens an approved record in force now; never a pending, future or past one", () => {
    const now = rec({ kind: "AL" });
    const p = plan({
      records: [
        now,
        rec({ kind: "OL", personId: "p2", state: "PENDING" }),
        rec({ kind: "OFF", personId: "p4", startAt: at("2026-10-15"), endAt: at("2026-10-16") }),
        rec({ kind: "OFF", personId: "p4", startAt: at("2026-10-10"), endAt: at("2026-10-12") }),
      ],
    });
    expect(p.writes).toEqual([{ op: "absence", personId: "p1", recordId: now.id, values: absenceValues(now), replaces: null, why: "open" }]);
    expect(p.notes).toEqual([]);
  });

  it("picks HL > MC > OL > AL > OFF > OTHERS > MA when several are in force", () => {
    const al = rec({ kind: "AL" });
    const mc = rec({ kind: "MC", state: "RECORDED" });
    const ma = rec({ kind: "MA", state: "RECORDED", maTiming: "1300" });
    expect(plan({ records: [al, ma, mc] }).writes.map((w) => (w.op === "absence" ? w.recordId : null))).toEqual([mc.id]);
  });

  it("leaves a GC's own absence alone: same type agrees, anything else is a conflict", () => {
    const al = rec({ kind: "AL" });
    expect(plan({ records: [al], absences: [v1abs({ type: "AL", startDate: "2026-10-12" })] })).toEqual({ writes: [], marks: [], notes: [{ op: "agrees", personId: "p1", recordId: al.id }] });
    const p = plan({ records: [al], absences: [v1abs({ type: "OTHERS", otherReason: "COURSE" })] });
    expect(p.writes).toEqual([]);
    expect(p.notes).toEqual([{ op: "conflict", personId: "p1", recordId: al.id, want: "AL", has: "COURSE" }]);
    // v1's own "RF @ X" home absence isn't ours to replace either
    expect(plan({ records: [al], absences: [v1abs({ type: "OTHERS", otherReason: "RF @ BDK", dutyId: "d1" })] }).notes[0].op).toBe("conflict");
  });

  it("does nothing when its own row already says it; updates it when the record moves", () => {
    const al = rec({ kind: "AL" });
    const { a, p } = ours(al);
    expect(plan({ records: [al], absences: [a], projections: [p] })).toEqual({ writes: [], marks: [], notes: [] });
    const longer = { ...al, endAt: at("2026-10-18") };
    expect(plan({ records: [longer], absences: [a], projections: [p] }).writes).toEqual([
      { op: "absence", personId: "p1", recordId: al.id, values: absenceValues(longer), replaces: p, why: "update" },
    ]);
  });

  it("lets go of a row a GC edited or closed, and doesn't reopen it for that record", () => {
    const al = rec({ kind: "AL" });
    const { a, p } = ours(al);
    const edited = plan({ records: [al], absences: [{ ...a, endDate: "2026-10-20" }], projections: [p] });
    expect(edited.writes).toEqual([]);
    expect(edited.marks).toEqual([{ op: "by-hand", projection: p }]);
    expect(edited.notes).toContainEqual({ op: "closed-by-hand", personId: "p1", recordId: al.id });

    const closed = plan({ records: [al], absences: [], projections: [p] });
    expect(closed.writes).toEqual([]);
    expect(closed.marks).toEqual([{ op: "by-hand", projection: p }]);
    // and on later syncs, with the projection closed BY_HAND
    expect(plan({ records: [al], projections: [{ ...p, closedAt: NOW, close: "BY_HAND" }] }).writes).toEqual([]);
  });

  it("never auto-reverts: an ended record waits for Back, then closes; a void closes at once", () => {
    const mc = rec({ kind: "MC", state: "RECORDED", startAt: at("2026-10-11"), endAt: at("2026-10-14") });
    const { a, p } = ours(mc);
    const waiting = plan({ records: [mc], absences: [a], projections: [p] });
    expect(waiting.writes).toEqual([]);
    expect(waiting.notes).toEqual([{ op: "due-back", personId: "p1", projection: p, what: "MC", endedAt: mc.endAt }]);

    const confirmed = { ...p, backConfirmedAt: NOW };
    expect(plan({ records: [mc], absences: [a], projections: [confirmed] }).writes).toEqual([{ op: "close-absence", personId: "p1", projection: confirmed, why: "BACK" }]);
    // confirmed before it ends: nothing until it has
    const running = rec({ kind: "MC", state: "RECORDED", startAt: at("2026-10-11"), endAt: at("2026-10-15") });
    const early = ours(running, { backConfirmedAt: NOW });
    expect(plan({ records: [running], absences: [early.a], projections: [early.p] })).toEqual({ writes: [], marks: [], notes: [] });

    for (const state of ["CANCELLED", "WITHDRAWN", "REJECTED"] as const) {
      expect(plan({ records: [{ ...mc, state }], absences: [a], projections: [p] }).writes).toEqual([{ op: "close-absence", personId: "p1", projection: p, why: "VOID" }]);
    }
    expect(plan({ records: [], absences: [a], projections: [p] }).writes[0]).toMatchObject({ op: "close-absence", why: "VOID" });
  });

  it("an ended MC with leave after it switches straight to the leave", () => {
    const mc = rec({ kind: "MC", state: "RECORDED", startAt: at("2026-10-11"), endAt: at("2026-10-14") });
    const al = rec({ kind: "AL", startAt: at("2026-10-14"), endAt: at("2026-10-17") });
    const { a, p } = ours(mc);
    expect(plan({ records: [mc, al], absences: [a], projections: [p] }).writes).toEqual([
      { op: "absence", personId: "p1", recordId: al.id, values: absenceValues(al), replaces: p, why: "switch" },
    ]);
  });

  it("waits while his team is off shift (v1 locks it)", () => {
    const al = rec({ kind: "AL", personId: "p3" });
    expect(plan({ records: [al] })).toEqual({ writes: [], marks: [], notes: [{ op: "waiting", personId: "p3", recordId: al.id, reason: "SFT B is off shift" }] });
  });
});

describe("planning duties", () => {
  it("an assignment in force becomes a duty; a GC's own duty agrees or conflicts", () => {
    const a = asg();
    expect(plan({ assignments: [a] }).writes).toEqual([{ op: "duty", personId: "p1", assignmentId: a.id, values: dutyValues(a, "sftA"), projection: null, why: "open" }]);
    expect(plan({ assignments: [asg({ startAt: at("2026-10-15") })] }).writes).toEqual([]);
    const theirs: V1Duty = { id: "d1", personId: "p1", type: "RF", campId: "bdk", startDate: "2026-10-13", startTime: null, endDate: "2026-10-16", endTime: null };
    expect(plan({ assignments: [a], duties: [theirs] }).notes).toEqual([{ op: "agrees", personId: "p1", assignmentId: a.id }]);
    expect(plan({ assignments: [a], duties: [{ ...theirs, type: "EXTRA" }] }).notes).toEqual([{ op: "conflict", personId: "p1", assignmentId: a.id, want: "RF @ BDK", has: "EXTRA @ BDK" }]);
  });

  it("stand down ends it; a natural end waits for Back", () => {
    const a = asg({ startAt: at("2026-10-10", "2100"), endAt: at("2026-10-13", "2100") });
    const row = dutyRow(dutyValues(a, "sftA"));
    const d: V1Duty = { id: "d1", ...row };
    const p = proj({ kind: "DUTY", assignmentId: a.id, dutyId: "d1", wrote: row });
    expect(plan({ assignments: [a], duties: [d], projections: [p] }).notes).toEqual([{ op: "due-back", personId: "p1", projection: p, what: "RF @ BDK", endedAt: a.endAt }]);
    expect(plan({ assignments: [a], duties: [d], projections: [{ ...p, backConfirmedAt: NOW }] }).writes[0]).toMatchObject({ op: "end-duty", why: "BACK" });
    expect(plan({ assignments: [{ ...a, state: "CANCELLED" }], duties: [d], projections: [p] }).writes[0]).toMatchObject({ op: "end-duty", why: "STOOD_DOWN" });
  });

  it("follows the assignment's new dates, unless a GC changed the duty", () => {
    const a = asg();
    const row = dutyRow(dutyValues(a, "sftA"));
    const d: V1Duty = { id: "d1", ...row };
    const p = proj({ kind: "DUTY", assignmentId: a.id, dutyId: "d1", wrote: row });
    const later = { ...a, endAt: at("2026-10-18", "2100") };
    expect(plan({ assignments: [later], duties: [d], projections: [p] }).writes).toEqual([
      { op: "duty", personId: "p1", assignmentId: a.id, values: dutyValues(later, "sftA"), projection: p, why: "update" },
    ]);
    const byHand = plan({ assignments: [later], duties: [{ ...d, endDate: "2026-10-20" }], projections: [p] });
    expect(byHand.writes).toEqual([]);
    expect(byHand.marks).toEqual([{ op: "by-hand", projection: p }]);
  });
});

describe("planning HOTOs", () => {
  it("the latest HOTO per post flips its team and the other team the other way", () => {
    const p = plan({
      shiftEvents: [
        { id: "e1", campId: "sftA", at: at("2026-10-13", "2100"), on: false },
        { id: "e2", campId: "sftB", at: at("2026-10-14", "0900"), on: true },
      ],
    });
    expect(p.writes).toEqual([
      { op: "shift", campId: "sftA", onShift: false, events: ["e1", "e2"] },
      { op: "shift", campId: "sftB", onShift: true, events: [] },
    ]);
  });

  it("marks HOTOs done when v1 already agrees, and lets an absence through once its team is on", () => {
    expect(plan({ shiftEvents: [{ id: "e1", campId: "sftA", at: at("2026-10-14", "0900"), on: true }] })).toEqual({
      writes: [],
      marks: [{ op: "shift-done", events: ["e1"] }],
      notes: [],
    });
    const al = rec({ kind: "AL", personId: "p3" });
    const p = plan({ records: [al], shiftEvents: [{ id: "e1", campId: "sftB", at: at("2026-10-14", "0900"), on: true }] });
    expect(p.writes.map((w) => w.op)).toEqual(["shift", "shift", "absence"]);
  });
});

describe("planning weekday camps (2026-10-14)", () => {
  // BDK runs Monday to Friday; NOW is Wednesday 14/10 1000
  const bdk = { campId: "bdk", pattern: { campId: "bdk", kind: "WEEKLY" as const, onDays: 1, offDays: 0, anchorDate: null, hotoTime: "2100", weekdayMask: 0b0011111, holidaysOff: true, bothOnAllowed: false } };
  const SAT = at("2026-10-17", "0900");
  const withBdk = (onShift: boolean) => camps.map((c) => (c.id === "bdk" ? { ...c, onShift } : c));

  it("switches it off at the weekend and on again on Monday", () => {
    const p = plan({ now: SAT, camps: withBdk(true), weekly: [{ ...bdk, overrides: [], wrote: { projectionId: "w1", on: true } }] });
    expect(p.writes).toEqual([{ op: "shift", campId: "bdk", onShift: false, events: [], weekly: { why: "pattern", projectionId: "w1" } }]);
    const mon = plan({ now: at("2026-10-19", "0700"), camps: withBdk(false), weekly: [{ ...bdk, overrides: [], wrote: { projectionId: "w1", on: false } }] });
    expect(mon.writes).toEqual([{ op: "shift", campId: "bdk", onShift: true, events: [], weekly: { why: "pattern", projectionId: "w1" } }]);
  });

  it("switches a GC's toggle back, and says so", () => {
    const p = plan({ camps: withBdk(false), weekly: [{ ...bdk, overrides: [], wrote: { projectionId: "w1", on: true } }] });
    expect(p.writes).toEqual([{ op: "shift", campId: "bdk", onShift: true, events: [], weekly: { why: "undo-hand", projectionId: "w1" } }]);
  });

  it("an admin's override wins", () => {
    const keepOn = [{ on: true, fromAt: at("2026-10-17"), untilAt: at("2026-10-19") }];
    expect(plan({ now: SAT, camps: withBdk(true), weekly: [{ ...bdk, overrides: keepOn, wrote: { projectionId: "w1", on: true } }] }).writes).toEqual([]);
    const p = plan({ now: SAT, camps: withBdk(false), weekly: [{ ...bdk, overrides: keepOn, wrote: { projectionId: "w1", on: false } }] });
    expect(p.writes).toEqual([{ op: "shift", campId: "bdk", onShift: true, events: [], weekly: { why: "override", projectionId: "w1" } }]);
  });

  it("remembers what it already says, so a later toggle shows; writes nothing", () => {
    const p = plan({ camps: withBdk(true), weekly: [{ ...bdk, overrides: [], wrote: null }] });
    expect(p).toEqual({ writes: [], marks: [{ op: "weekly-seen", campId: "bdk", on: true, projectionId: null }], notes: [] });
  });

  it("an absence at a camp switched off waits, like an off-shift team", () => {
    const al = rec({ kind: "AL", personId: "p4", startAt: at("2026-10-16"), endAt: at("2026-10-20") });
    const p = plan({ now: SAT, camps: withBdk(true), records: [al], weekly: [{ ...bdk, overrides: [], wrote: null }] });
    expect(p.writes.map((w) => w.op)).toEqual(["shift"]);
    expect(p.notes).toContainEqual(expect.objectContaining({ op: "waiting", personId: "p4" }));
  });
});
