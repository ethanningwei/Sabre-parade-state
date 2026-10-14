// The projection plan: what the parade state (v1 absence, duty, camp.on_shift)
// should say right now according to the timeline, against what it does say,
// as a list of writes. Pure: lib/wb/projection.ts loads the rows, and either
// applies the plan through the v1 cores (FEATURE_PROJECTION on) or only
// reports it (the shadow diff).
//
// v1 counts an open absence or duty the moment it exists, whatever its dates,
// so only what is in force NOW is projected. The rules (status §3b, §5):
// - Only APPROVED/RECORDED records are projected; pending ones never. RSI, RSO
//   and STATUS are never absences.
// - One open absence per man: the highest of HL > MC > OL > AL > OFF > OTHERS
//   > MA in force now.
// - Never overwrite an absence a GC typed: same type agrees, anything else is
//   a conflict, reported and left alone.
// - Never auto-revert: when a record ends, its absence stays open until a
//   commander confirms "Back" (then it closes). A void closes it at once.
// - A row the projector wrote and a GC then closed or edited by hand is let go
//   (wb_projection.wrote keeps what it wrote, to tell) and never reopened for
//   the same record.
// - Extra/RF/SOL: an ACTIVE assignment in force becomes a v1 duty (v1's own
//   saveDuty adds the "RF @ X" home absence); stand down ends it; a natural end
//   waits for "Back" like an absence.
// - A HOTO flips camp.on_shift for its team and the other way for the team it
//   pairs with; only the latest HOTO per post counts.

import { statusFields, type AbsenceFields } from "@/lib/core/status-fields";
import { toSgt } from "@/lib/parade/time";
import type { AbsenceType, DutyType } from "@/lib/parade/types";
import { addDays } from "./timeline";
import type { WbProjectionClose } from "./projection-kinds";
import type { WbAssignmentState, WbAssignmentType } from "./rf";
import { STANDING_STATES, type WbRecordKind, type WbRecordState } from "./rules";

// ------------------------------------------------------------------ inputs

export interface PRecord {
  id: string;
  personId: string;
  kind: WbRecordKind;
  state: WbRecordState;
  absent: boolean;
  startAt: Date;
  endAt: Date | null;
  detail: string;
  location: string;
  maTiming: string | null;
}

export interface PAssignment {
  id: string;
  personId: string;
  type: WbAssignmentType;
  campId: string;
  startAt: Date;
  endAt: Date;
  state: WbAssignmentState;
}

export interface PShiftEvent {
  id: string;
  campId: string;
  at: Date;
  on: boolean;
}

/** An open v1 absence. */
export interface V1Absence {
  id: string;
  personId: string;
  type: AbsenceType;
  otherReason: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  maTiming: string;
  maLocation: string;
  dutyId: string | null;
}

/** An open v1 duty. */
export interface V1Duty {
  id: string;
  personId: string | null;
  type: DutyType;
  campId: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}

export interface PCamp {
  id: string;
  name: string;
  post: string;
  subunitId: string;
  onShift: boolean;
}

export interface PProjection {
  id: string;
  kind: "ABSENCE" | "DUTY" | "SHIFT";
  personId: string | null;
  recordId: string | null;
  assignmentId: string | null;
  absenceId: string | null;
  dutyId: string | null;
  closedAt: Date | null;
  close: WbProjectionClose | null;
  backConfirmedAt: Date | null;
  /** what the projector last wrote (absenceRow / dutyRow), to spot a GC's edit */
  wrote: unknown;
}

export interface PlanInput {
  now: Date;
  /** records in force now, plus every record an open projection points at */
  records: readonly PRecord[];
  /** assignments in force now, plus every assignment an open projection points at */
  assignments: readonly PAssignment[];
  /** HOTOs not yet projected, at or before now */
  shiftEvents: readonly PShiftEvent[];
  /** the coy's open v1 absences and duties */
  absences: readonly V1Absence[];
  duties: readonly V1Duty[];
  camps: readonly PCamp[];
  /** personId -> his camp */
  homeOf: ReadonlyMap<string, string>;
  /** open projections, and closed ones for the records and assignments above */
  projections: readonly PProjection[];
}

// ------------------------------------------------------------------ the plan

/** setStatus's input for one man, as the projector would send it. */
export interface AbsenceValues {
  status: AbsenceType;
  otherReason: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  maTiming: string;
  maLocation: string;
}

/** saveDuty's input, as the projector would send it. */
export interface DutyValues {
  type: DutyType;
  rank: "";
  name: "";
  personId: string;
  campId: string;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
}

export type Write =
  /** open or change the man's absence: setStatus (same type edits in place, else replaces) */
  | { op: "absence"; personId: string; recordId: string; values: AbsenceValues; replaces: PProjection | null; why: "open" | "update" | "switch" }
  /** close the absence the projector owns: setStatus PRESENT */
  | { op: "close-absence"; personId: string; projection: PProjection; why: "VOID" | "BACK" }
  | { op: "duty"; personId: string; assignmentId: string; values: DutyValues; projection: PProjection | null; why: "open" | "update" }
  | { op: "end-duty"; personId: string; assignmentId: string | null; projection: PProjection; why: "STOOD_DOWN" | "BACK" | "VOID" }
  /** flip camp.on_shift; events lists every HOTO it settles */
  | { op: "shift"; campId: string; onShift: boolean; events: string[] };

/** Bookkeeping only: no v1 write, but wb_projection changes. */
export type Mark =
  /** the projector's row was closed or changed by a GC: stop owning it */
  | { op: "by-hand"; projection: PProjection }
  /** HOTOs that need no write (v1 already agrees, or a later one wins) */
  | { op: "shift-done"; events: string[] };

export type Note =
  /** a GC's own absence or duty disagrees: left alone */
  | { op: "conflict"; personId: string; recordId?: string; assignmentId?: string; want: string; has: string }
  /** a GC's own absence or duty already says the same */
  | { op: "agrees"; personId: string; recordId?: string; assignmentId?: string }
  /** ended, waiting for a commander's "Back" */
  | { op: "due-back"; personId: string; projection: PProjection; what: string; endedAt: Date }
  /** v1 won't take it now (the team is off shift): tried again on the next sync */
  | { op: "waiting"; personId: string; recordId: string; reason: string }
  /** a GC closed the projector's row for this record: not reopened */
  | { op: "closed-by-hand"; personId: string; recordId?: string; assignmentId?: string };

export interface Plan {
  writes: Write[];
  marks: Mark[];
  notes: Note[];
}

// ------------------------------------------------------------------ mapping

/** HL > MC > OL > AL > OFF > OTHERS > MA: the one v1 shows when several are in force. */
export const PRIORITY: readonly AbsenceType[] = ["HL", "MC", "OL", "AL", "OFF", "OTHERS", "MA"];

const TYPE_OF: Partial<Record<WbRecordKind, AbsenceType>> = { MC: "MC", HL: "HL", AL: "AL", OL: "OL", OFF: "OFF", MA: "MA", EVENT: "OTHERS" };

/** v1's type for a record, or null for what's never projected (RSI, RSO, STATUS, or not away). */
export function v1TypeOf(r: Pick<PRecord, "kind" | "absent">): AbsenceType | null {
  return r.absent ? (TYPE_OF[r.kind] ?? null) : null;
}

/** An instant as v1's date + optional time: midnight is the whole day, so no time. */
export function v1Start(at: Date): { date: string; time: string | null } {
  const s = toSgt(at);
  return { date: s.date, time: s.time === "0000" ? null : s.time };
}

/** An exclusive end as v1's inclusive date + time: an end at midnight is the day before, all of it. */
export function v1End(at: Date): { date: string; time: string | null } {
  const e = toSgt(at);
  return e.time === "0000" ? { date: addDays(e.date, -1), time: null } : { date: e.date, time: e.time };
}

const clip = (s: string, n: number) => s.trim().slice(0, n);

/** What setStatus is sent for a record. Null when it's never projected. */
export function absenceValues(r: PRecord): AbsenceValues | null {
  const type = v1TypeOf(r);
  if (!type) return null;
  const start = v1Start(r.startAt);
  const end = r.endAt ? v1End(r.endAt) : null;
  if (type === "MA") {
    return {
      status: "MA",
      otherReason: "",
      startDate: start.date,
      startTime: null,
      endDate: null,
      endTime: null,
      maTiming: clip(r.maTiming ?? "", 20),
      maLocation: clip(r.location, 100),
    };
  }
  return {
    status: type,
    otherReason: type === "OTHERS" ? clip(r.detail || "Event", 200) : "",
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    maTiming: "",
    maLocation: "",
  };
}

/** What saveDuty is sent for an assignment. SOL's camp is his own (saveDuty ignores it anyway). */
export function dutyValues(a: PAssignment, homeCampId: string | undefined): DutyValues {
  const start = v1Start(a.startAt);
  const end = v1End(a.endAt);
  return {
    type: a.type,
    rank: "",
    name: "",
    personId: a.personId,
    campId: a.type === "SOL" ? (homeCampId ?? a.campId) : a.campId,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

/** The absence row setStatus leaves for these values: what wb_projection.wrote keeps. */
export const absenceRow = (v: AbsenceValues): AbsenceFields => statusFields(v)!;

/** The v1 duty row's fields saveDuty writes for these values: what wb_projection.wrote keeps. */
export const dutyRow = (v: DutyValues) => ({
  type: v.type,
  personId: v.personId,
  campId: v.campId,
  startDate: v.startDate,
  startTime: v.startTime,
  endDate: v.endDate,
  endTime: v.endTime,
});
export type DutyRow = ReturnType<typeof dutyRow>;

const ABSENCE_KEYS = ["type", "otherReason", "startDate", "startTime", "endDate", "endTime", "maTiming", "maLocation"] as const;
const DUTY_KEYS = ["type", "personId", "campId", "startDate", "startTime", "endDate", "endTime"] as const;
const sameKeys = (keys: readonly string[], a: object, b: unknown) =>
  !!b && typeof b === "object" && keys.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);

/** Does the v1 absence say exactly this (an absenceRow)? */
export const absenceSays = (a: V1Absence, row: unknown) => sameKeys(ABSENCE_KEYS, a, row);
/** Does the v1 duty say exactly this (a dutyRow)? */
export const dutySays = (d: V1Duty, row: unknown) => sameKeys(DUTY_KEYS, d, row);

const inForce = (r: { startAt: Date; endAt: Date | null }, now: Date) =>
  r.startAt.getTime() <= now.getTime() && (r.endAt === null || now.getTime() < r.endAt.getTime());
const ended = (r: { endAt: Date | null }, now: Date) => r.endAt !== null && r.endAt.getTime() <= now.getTime();

export const absenceLabel = (a: Pick<V1Absence, "type" | "otherReason">) => (a.type === "OTHERS" ? a.otherReason || "OTHERS" : a.type);

// ------------------------------------------------------------------ planning

export function planProjection(input: PlanInput): Plan {
  const { now } = input;
  const plan: Plan = { writes: [], marks: [], notes: [] };

  // ---- shifts first: absences on a team v1 has off shift can't be written
  const onShift = new Map(input.camps.map((c) => [c.id, c.onShift]));
  const campById = new Map(input.camps.map((c) => [c.id, c]));
  const latestByPost = new Map<string, PShiftEvent>();
  const eventsByPost = new Map<string, string[]>();
  for (const e of input.shiftEvents) {
    const c = campById.get(e.campId);
    if (!c || e.at.getTime() > now.getTime()) continue;
    const key = `${c.subunitId}\u0000${c.post}`;
    eventsByPost.set(key, [...(eventsByPost.get(key) ?? []), e.id]);
    const had = latestByPost.get(key);
    if (!had || e.at.getTime() > had.at.getTime()) latestByPost.set(key, e);
  }
  for (const [key, e] of latestByPost) {
    const team = campById.get(e.campId)!;
    const teams = input.camps.filter((c) => `${c.subunitId}\u0000${c.post}` === key);
    const events = eventsByPost.get(key)!;
    let wrote = false;
    for (const t of teams) {
      const want = t.id === team.id ? e.on : !e.on;
      if (t.onShift === want) continue;
      plan.writes.push({ op: "shift", campId: t.id, onShift: want, events: wrote ? [] : events });
      onShift.set(t.id, want);
      wrote = true;
    }
    if (!wrote) plan.marks.push({ op: "shift-done", events });
  }

  // ---- indexes
  const recordById = new Map(input.records.map((r) => [r.id, r]));
  const assignmentById = new Map(input.assignments.map((a) => [a.id, a]));
  const openAbsenceOf = new Map(input.absences.map((a) => [a.personId, a]));
  const absenceById = new Map(input.absences.map((a) => [a.id, a]));
  const dutyById = new Map(input.duties.map((d) => [d.id, d]));
  const open = input.projections.filter((p) => !p.closedAt);
  const ownerOfAbsence = new Map(open.filter((p) => p.kind === "ABSENCE" && p.absenceId).map((p) => [p.absenceId!, p]));
  const ownerOfDuty = new Map(open.filter((p) => p.kind === "DUTY" && p.dutyId).map((p) => [p.dutyId!, p]));
  const byHandRecords = new Set(input.projections.filter((p) => p.close === "BY_HAND" && p.recordId).map((p) => p.recordId!));
  const byHandAssignments = new Set(input.projections.filter((p) => p.close === "BY_HAND" && p.assignmentId).map((p) => p.assignmentId!));

  // the projector's rows a GC has since closed or edited in the web app: let go of them
  const handled = new Set<string>();
  for (const p of open) {
    const a = p.absenceId ? absenceById.get(p.absenceId) : undefined;
    if (p.kind === "ABSENCE" && (!a || !absenceSays(a, p.wrote))) {
      plan.marks.push({ op: "by-hand", projection: p });
      handled.add(p.id);
      if (p.recordId) byHandRecords.add(p.recordId);
    }
    const d = p.dutyId ? dutyById.get(p.dutyId) : undefined;
    if (p.kind === "DUTY" && (!d || !dutySays(d, p.wrote))) {
      plan.marks.push({ op: "by-hand", projection: p });
      handled.add(p.id);
      if (p.assignmentId) byHandAssignments.add(p.assignmentId);
    }
  }

  // ---- duties (before absences: their "RF @ X" home absence is saveDuty's business)
  const projectedDutyOf = new Map<string, PProjection>(); // assignmentId -> open projection
  for (const p of open) if (p.kind === "DUTY" && p.assignmentId && !handled.has(p.id)) projectedDutyOf.set(p.assignmentId, p);

  for (const a of input.assignments) {
    const p = projectedDutyOf.get(a.id) ?? null;
    const live = a.state === "ACTIVE";
    if (p) {
      const d = dutyById.get(p.dutyId!)!;
      if (!live) {
        plan.writes.push({ op: "end-duty", personId: a.personId, assignmentId: a.id, projection: p, why: "STOOD_DOWN" });
      } else if (ended(a, now)) {
        if (p.backConfirmedAt) plan.writes.push({ op: "end-duty", personId: a.personId, assignmentId: a.id, projection: p, why: "BACK" });
        else plan.notes.push({ op: "due-back", personId: a.personId, projection: p, what: `${a.type} @ ${campById.get(a.campId)?.name ?? "?"}`, endedAt: a.endAt });
      } else if (!inForce(a, now)) {
        plan.writes.push({ op: "end-duty", personId: a.personId, assignmentId: a.id, projection: p, why: "VOID" }); // moved later
      } else {
        const v = dutyValues(a, input.homeOf.get(a.personId));
        if (!dutySays(d, dutyRow(v))) plan.writes.push({ op: "duty", personId: a.personId, assignmentId: a.id, values: v, projection: p, why: "update" });
      }
      continue;
    }
    if (!live || !inForce(a, now)) continue;
    if (byHandAssignments.has(a.id)) {
      plan.notes.push({ op: "closed-by-hand", personId: a.personId, assignmentId: a.id });
      continue;
    }
    const v = dutyValues(a, input.homeOf.get(a.personId));
    const his = input.duties.filter((d) => d.personId === a.personId && !ownerOfDuty.has(d.id));
    const same = his.find((d) => d.type === v.type && d.campId === v.campId);
    if (same) plan.notes.push({ op: "agrees", personId: a.personId, assignmentId: a.id });
    else if (his.length)
      plan.notes.push({
        op: "conflict",
        personId: a.personId,
        assignmentId: a.id,
        want: `${a.type} @ ${campById.get(v.campId)?.name ?? "?"}`,
        has: his.map((d) => `${d.type} @ ${campById.get(d.campId)?.name ?? "?"}`).join(", "),
      });
    else plan.writes.push({ op: "duty", personId: a.personId, assignmentId: a.id, values: v, projection: null, why: "open" });
  }

  // ---- absences, one man at a time
  const people = new Set<string>();
  for (const r of input.records) people.add(r.personId);
  for (const p of open) if (p.kind === "ABSENCE" && p.personId && !handled.has(p.id)) people.add(p.personId);

  for (const personId of people) {
    const current = input.records
      .filter((r) => r.personId === personId && STANDING_STATES.includes(r.state) && v1TypeOf(r) && inForce(r, now) && !byHandRecords.has(r.id))
      .sort((x, y) => PRIORITY.indexOf(v1TypeOf(x)!) - PRIORITY.indexOf(v1TypeOf(y)!) || x.startAt.getTime() - y.startAt.getTime());
    for (const r of input.records) {
      if (r.personId === personId && byHandRecords.has(r.id) && STANDING_STATES.includes(r.state) && v1TypeOf(r) && inForce(r, now)) {
        plan.notes.push({ op: "closed-by-hand", personId, recordId: r.id });
      }
    }
    const top = current[0] ?? null;
    const v1 = openAbsenceOf.get(personId) ?? null;
    const mine = v1 ? (ownerOfAbsence.get(v1.id) ?? null) : null;
    const mineLive = mine && !handled.has(mine.id) ? mine : null;
    const home = input.homeOf.get(personId);
    const offShift = home !== undefined && onShift.get(home) === false;

    if (top) {
      const values = absenceValues(top)!;
      if (v1 && !mineLive) {
        // a GC's own entry (or v1's "RF @ X" for a duty): never overwritten
        if (v1.type === values.status && !v1.dutyId) plan.notes.push({ op: "agrees", personId, recordId: top.id });
        else plan.notes.push({ op: "conflict", personId, recordId: top.id, want: values.status === "OTHERS" ? values.otherReason : values.status, has: absenceLabel(v1) });
        continue;
      }
      if (mineLive && mineLive.recordId === top.id && absenceSays(v1!, absenceRow(values))) continue;
      if (offShift) {
        plan.notes.push({ op: "waiting", personId, recordId: top.id, reason: `${input.camps.find((c) => c.id === home)?.name ?? "His team"} is off shift` });
        continue;
      }
      const why = !mineLive ? "open" : v1!.type === values.status ? "update" : "switch";
      plan.writes.push({ op: "absence", personId, recordId: top.id, values, replaces: mineLive, why });
      continue;
    }

    if (!mineLive) continue;
    const r = mineLive.recordId ? recordById.get(mineLive.recordId) : undefined;
    const standing = r && STANDING_STATES.includes(r.state) && v1TypeOf(r);
    if (standing && ended(r, now)) {
      if (mineLive.backConfirmedAt && !offShift) plan.writes.push({ op: "close-absence", personId, projection: mineLive, why: "BACK" });
      else plan.notes.push({ op: "due-back", personId, projection: mineLive, what: absenceLabel(v1!), endedAt: r.endAt! });
      continue;
    }
    // voided, withdrawn, rejected, cancelled, gone, or moved to later: he isn't away now
    if (offShift) plan.notes.push({ op: "waiting", personId, recordId: mineLive.recordId ?? "", reason: "his team is off shift" });
    else plan.writes.push({ op: "close-absence", personId, projection: mineLive, why: "VOID" });
  }

  // assignments no longer loaded but still owned (deleted): end them
  for (const p of projectedDutyOf.values()) {
    if (p.assignmentId && !assignmentById.has(p.assignmentId)) {
      plan.writes.push({ op: "end-duty", personId: p.personId ?? "", assignmentId: p.assignmentId, projection: p, why: "VOID" });
    }
  }
  for (const p of open) {
    if (p.kind === "DUTY" && !p.assignmentId && !handled.has(p.id)) {
      plan.writes.push({ op: "end-duty", personId: p.personId ?? "", assignmentId: null, projection: p, why: "VOID" });
    }
  }
  return plan;
}
