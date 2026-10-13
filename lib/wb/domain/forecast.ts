import { computeCoy, type CampState } from "@/lib/parade/compute";
import { toSgt } from "@/lib/parade/time";
import type { AbsenceType, CoySnapshot, SnapshotAbsence, SnapshotDuty, SnapshotPerson } from "@/lib/parade/types";
import { KIND_LABEL } from "./describe";
import type { WbAssignmentType } from "./rf";
import { isAbsentKind, STANDING_STATES, type WbRecordKind, type WbRecordState } from "./rules";
import { gaps, minimumLabel, onDuring, shortfall, strengthLabel, strengthOf, type Gap, type Minimum, type ShiftPattern, type Strength } from "./shifts";
import { addDays, dayMonth, dayRange, daysTouched, overlaps, type Range } from "./timeline";

// The forecast: what the parade state would say at another moment, worked out
// by the unchanged v1 engine (computeCoy) from a snapshot built for that
// moment. Pure: the caller loads the roster, the patterns and the timeline.
//
// It works from what troopers and commanders key into the Mini App (the
// timeline), never from the parade state's own absences or Extra/RF/SOL: those
// are typed by hand, often undated, and go stale (decided 2026-10-12). The
// roster (who is posted where, and their role) is the only thing taken from
// v1. In the end (Phase 6) the parade state is fed from the timeline, not the
// other way round.
//
// Extra/RF/SOL come from wb_assignment (Phase 5), by v1's own rule: each is a
// SnapshotDuty that computeCoy places with servingCampId, and an RF or Extra
// man is away at home as OTHERS "RF @ BDK" unless he's already away for a real
// reason (v1's syncHomeAbsence). SOL never takes him away from home.

export interface TimelineRow {
  id: string;
  personId: string;
  kind: WbRecordKind;
  state: WbRecordState;
  startAt: Date;
  endAt: Date | null;
  detail: string;
}

/** A live (ACTIVE) wb_assignment: where a man stands for a while. */
export interface AssignmentRow {
  id: string;
  personId: string;
  type: WbAssignmentType;
  /** where he stands; his own camp for SOL */
  campId: string;
  startAt: Date;
  endAt: Date | null;
}

export interface ForecastInput {
  /** the roster: camps and people, from loadSnapshot. Its absences and duties are ignored */
  base: CoySnapshot;
  now: Date;
  /** campId -> pattern; a camp without one keeps its v1 onShift */
  patterns: ReadonlyMap<string, ShiftPattern>;
  /** live timeline rows (pending, approved, recorded); others are ignored */
  records: readonly TimelineRow[];
  /** live Extra/RF/SOL (ACTIVE only) */
  assignments?: readonly AssignmentRow[];
}

export interface SnapshotOptions {
  /** count PENDING requests as away too */
  pending?: boolean;
  /** count this record as away whatever its state or kind (the request on a card) */
  assume?: string;
}

export interface Built {
  snapshot: CoySnapshot;
  /** who is away only because of a pending request */
  pendingAway: ReadonlySet<string>;
  /** personId -> the timeline row that put them away */
  byRecord: ReadonlyMap<string, TimelineRow>;
  /** personId -> the Extra/RF that put them away from home */
  byAssignment: ReadonlyMap<string, AssignmentRow>;
}

const TYPE_OF: Partial<Record<WbRecordKind, AbsenceType>> = { MC: "MC", HL: "HL", AL: "AL", OL: "OL", OFF: "OFF", MA: "MA" };

const sgtFields = (r: { startAt: Date; endAt: Date | null }) => {
  const s = toSgt(r.startAt);
  const e = r.endAt ? toSgt(r.endAt) : null;
  return { startDate: s.date, startTime: s.time, endDate: e?.date ?? null, endTime: e?.time ?? null };
};

/** v1's home absence for a man serving Extra/RF elsewhere: OTHERS "RF @ BDK", the duty's dates. */
function sentAbsence(a: AssignmentRow, at: string): SnapshotAbsence {
  return { id: `wba:${a.id}`, type: "OTHERS", otherReason: `${a.type} @ ${at}`, ...sgtFields(a), maTiming: "", maLocation: "" };
}

function asAbsence(r: TimelineRow): SnapshotAbsence {
  const s = toSgt(r.startAt);
  const e = r.endAt ? toSgt(r.endAt) : null;
  const type = TYPE_OF[r.kind] ?? "OTHERS";
  return {
    id: `wb:${r.id}`,
    type,
    otherReason: type === "OTHERS" ? r.detail || KIND_LABEL[r.kind] : "",
    startDate: s.date,
    startTime: s.time,
    endDate: e?.date ?? null,
    endTime: e?.time ?? null,
    maTiming: "",
    maLocation: "",
  };
}

/** The v1 snapshot for a window: shifts from the patterns, absences from the timeline only. */
export function snapshotFor(input: ForecastInput, window: Range, opts: SnapshotOptions = {}): Built {
  const counts = (r: TimelineRow) =>
    r.id === opts.assume ||
    (isAbsentKind(r.kind) && (STANDING_STATES.includes(r.state) || (opts.pending && r.state === "PENDING")));
  const away = new Map<string, TimelineRow>();
  for (const r of input.records) {
    if (!counts(r) || !overlaps(r, window)) continue;
    // the request in question first, then a standing row over a pending one
    const had = away.get(r.personId);
    if (!had || r.id === opts.assume || (had.state === "PENDING" && r.state !== "PENDING" && had.id !== opts.assume)) away.set(r.personId, r);
  }
  const pendingAway = new Set<string>();
  const byRecord = new Map<string, TimelineRow>();
  const byAssignment = new Map<string, AssignmentRow>();

  // Extra/RF/SOL in force at any moment of the window, as v1 duties
  const people = new Map<string, SnapshotPerson & { campId: string }>();
  const campName = new Map<string, string>();
  for (const s of input.base.subunits)
    for (const c of s.camps) {
      campName.set(c.id, c.name);
      for (const p of c.people) people.set(p.id, { ...p, campId: c.id });
    }
  const duties: SnapshotDuty[] = [];
  const sentAway = new Map<string, AssignmentRow>();
  for (const a of input.assignments ?? []) {
    const who = people.get(a.personId);
    if (!who || !overlaps(a, window)) continue;
    duties.push({ id: `wba:${a.id}`, type: a.type, rank: who.rank, name: who.name, personId: a.personId, campId: a.campId, ...sgtFields(a) });
    if (a.type !== "SOL" && a.campId !== who.campId && !sentAway.has(a.personId)) sentAway.set(a.personId, a);
  }

  const person = (p: SnapshotPerson): SnapshotPerson => {
    const r = away.get(p.id);
    if (!r) {
      // already away for a real reason (an MC): that absence is kept, as v1 does
      const a = sentAway.get(p.id);
      if (!a) return { ...p, absence: null };
      byAssignment.set(p.id, a);
      return { ...p, absence: sentAbsence(a, campName.get(a.campId) ?? "another camp") };
    }
    byRecord.set(p.id, r);
    if (r.state === "PENDING" && r.id !== opts.assume) pendingAway.add(p.id);
    return { ...p, absence: asAbsence(r) };
  };

  const snapshot: CoySnapshot = {
    coy: input.base.coy,
    subunits: input.base.subunits.map((s) => ({
      ...s,
      camps: s.camps.map((c) => {
        const p = input.patterns.get(c.id);
        const on = p ? onDuring(p, window) : null;
        return { ...c, onShift: on ?? c.onShift, people: c.people.map(person) };
      }),
    })),
    // the parade state's own Extra/RF/SOL aren't read: only wb_assignment
    duties,
  };
  return { snapshot, pendingAway, byRecord, byAssignment };
}

/** The snapshot at one instant (spec: snapshotAt). */
export const snapshotAt = (input: ForecastInput, t: Date, opts: SnapshotOptions = {}) =>
  snapshotFor(input, { startAt: t, endAt: new Date(t.getTime() + 1) }, opts);

// ------------------------------------------------------------------ manning

export interface AwayPerson {
  personId: string;
  rank: string;
  name: string;
  role: string;
  /** "AL", "MC", "OTHERS: RF @ BDK" */
  what: string;
  /** "05/10–06/10", "from 05/10", or "" when v1 has no dates */
  dates: string;
  /** the timeline row, when it came from there */
  recordId: string | null;
  /** the Extra/RF that sent him elsewhere, when that's why */
  assignmentId: string | null;
  pending: boolean;
}

export interface CampManning {
  campId: string;
  campName: string;
  post: string;
  subunitId: string;
  subunitName: string;
  isHq: boolean;
  on: boolean;
  /** standing heads by role, sent-in Extra/RF/SOL included (they're hands this camp has) */
  strength: Strength;
  total: number;
  away: AwayPerson[];
  duties: SnapshotDuty[];
}

const awayWhat = (p: SnapshotPerson) => (p.absence!.type === "OTHERS" ? `OTHERS: ${p.absence!.otherReason}` : p.absence!.type);

/** An absence's days as written, the end at midnight read as the day before. */
function awayDates(a: SnapshotAbsence): string {
  if (!a.startDate) return a.endDate ? `until ${dayMonth(a.endDate)}` : "";
  if (!a.endDate) return `from ${dayMonth(a.startDate)}`;
  const last = a.endTime === "0000" ? addDays(a.endDate, -1) : a.endDate;
  return last <= a.startDate ? dayMonth(a.startDate) : `${dayMonth(a.startDate)}–${dayMonth(last)}`;
}

/** Each camp's manning in a built snapshot, by computeCoy. */
export function manningOf(built: Built): CampManning[] {
  const roleOfPerson = new Map<string, string>();
  for (const s of built.snapshot.subunits) for (const c of s.camps) for (const p of c.people) roleOfPerson.set(p.id, p.role);
  const out: CampManning[] = [];
  const state = computeCoy(built.snapshot);
  for (const s of state.subunits) {
    for (const c of s.camps as CampState[]) {
      const awayIds = new Set(c.absentees.map((p) => p.id));
      const sentIn = [...c.duties.EXTRA, ...c.duties.RF, ...c.duties.SOL];
      const roles = c.onShift
        ? [...c.camp.people.filter((p) => !awayIds.has(p.id)).map((p) => p.role), ...sentIn.map((d) => (d.personId ? (roleOfPerson.get(d.personId) ?? "") : ""))]
        : [];
      out.push({
        campId: c.camp.id,
        campName: c.camp.name,
        post: c.camp.post,
        subunitId: s.subunit.id,
        subunitName: s.subunit.name,
        isHq: s.subunit.isHq,
        on: c.onShift,
        strength: strengthOf(roles),
        total: c.total,
        away: c.absentees.map((p) => ({
          personId: p.id,
          rank: p.rank,
          name: p.name,
          role: p.role,
          what: awayWhat(p),
          dates: awayDates(p.absence!),
          recordId: built.byRecord.get(p.id)?.id ?? null,
          assignmentId: built.byAssignment.get(p.id)?.id ?? null,
          pending: built.pendingAway.has(p.id),
        })),
        duties: sentIn,
      });
    }
  }
  return out;
}

export interface Verdict {
  /** null: no minimum set */
  minimum: Minimum | null;
  gaps: Gap[];
  label: string;
}

export function verdict(m: CampManning, minimum: Minimum | null): Verdict {
  return { minimum, gaps: minimum && m.on ? gaps(minimum, m.strength) : [], label: strengthLabel(m.strength, minimum) };
}

// ------------------------------------------------------------------ the grid

export interface GridCell {
  date: string;
  /** off shift that day: nothing to man */
  on: boolean;
  label: string;
  /** below minimum on approved records alone */
  short: boolean;
  /** not short on approved records, but would be if the pending ones were approved */
  pendingShort: boolean;
  /** what pending requests would make it, when that differs */
  pendingLabel: string | null;
}

export interface GridRow {
  campId: string;
  campName: string;
  subunitId: string;
  subunitName: string;
  minimum: Minimum | null;
  cells: GridCell[];
}

/** The next n days from a date. */
export const nextDays = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** Camps × days: each day's strength on approved records, and what pending requests would do to it. */
export function forecastGrid(input: ForecastInput, campIds: readonly string[], days: readonly string[], minimums: ReadonlyMap<string, Minimum>): GridRow[] {
  const wanted = new Set(campIds);
  const rows = new Map<string, GridRow>();
  for (const date of days) {
    const approved = manningOf(snapshotFor(input, dayRange(date)));
    const pending = new Map(manningOf(snapshotFor(input, dayRange(date), { pending: true })).map((m) => [m.campId, m]));
    for (const m of approved) {
      if (!wanted.has(m.campId)) continue;
      const min = minimums.get(m.campId) ?? null;
      const row = rows.get(m.campId) ?? { campId: m.campId, campName: m.campName, subunitId: m.subunitId, subunitName: m.subunitName, minimum: min, cells: [] };
      const a = verdict(m, min);
      const p = verdict(pending.get(m.campId)!, min);
      row.cells.push({
        date,
        on: m.on,
        label: a.label,
        short: a.gaps.length > 0,
        pendingShort: a.gaps.length === 0 && p.gaps.length > 0,
        pendingLabel: p.label !== a.label ? p.label : null,
      });
      rows.set(m.campId, row);
    }
  }
  return campIds.map((id) => rows.get(id)).filter((r): r is GridRow => !!r);
}

// ------------------------------------------------------------------ a request's worst day

export interface WorstDay {
  date: string;
  manning: CampManning;
  verdict: Verdict;
  /** the same day if every pending request were approved too */
  withPending: Verdict;
  /** other pending requests away that day */
  pendingCount: number;
  multiDay: boolean;
}

/**
 * The worst day of a request for its camp, with the requester counted out
 * (Sabre Bot's _manning, which counted him out because his row was already
 * PENDING). Days the camp is off shift don't count: nobody is short of men on
 * a day it isn't manned. Null when it's off for all of it.
 */
export function worstDay(input: ForecastInput, record: TimelineRow & { campId: string }, minimum: Minimum | null): WorstDay | null {
  return worstDayOf(input, record.campId, record, minimum, record.id);
}

/**
 * The worst day of a camp over a range (most short, then fewest heads), days
 * it's off shift left out. `assume` counts that record as away whatever its
 * state. Null when the camp is off for all of it.
 */
export function worstDayOf(input: ForecastInput, campId: string, range: Range, minimum: Minimum | null, assume?: string): WorstDay | null {
  const days = daysTouched(range);
  let worst: WorstDay | null = null;
  for (const date of days) {
    const m = manningOf(snapshotFor(input, dayRange(date), { assume })).find((x) => x.campId === campId);
    if (!m || !m.on) continue;
    const v = verdict(m, minimum);
    const score = [shortfall(v.gaps), -m.strength.present] as const;
    const best = worst ? ([shortfall(worst.verdict.gaps), -worst.manning.strength.present] as const) : null;
    if (!best || score[0] > best[0] || (score[0] === best[0] && score[1] > best[1])) {
      const p = manningOf(snapshotFor(input, dayRange(date), { assume, pending: true })).find((x) => x.campId === campId)!;
      worst = { date, manning: m, verdict: v, withPending: verdict(p, minimum), pendingCount: p.away.filter((a) => a.pending).length, multiDay: days.length > 1 };
    }
  }
  return worst;
}

/**
 * The card's manning line. "SLR on 14/10 (worst day): 0:3:3 / min 1:4:3 —
 * BELOW MINIMUM". A report sick isn't an absence, so for one the line says
 * what an MC would do. Empty for COY HQ.
 */
export function manningLine(
  camp: { name: string; isHq: boolean },
  w: WorstDay | null,
  opts: { minimum: Minimum | null; ifMc?: boolean },
): string {
  if (camp.isHq) return "";
  if (!opts.minimum) return `No minimum manning set for ${camp.name}`;
  if (!w) return `${camp.name} is off shift for all of it`;
  const when = `${camp.name} on ${dayMonth(w.date)}${w.multiDay ? " (worst day)" : ""}${opts.ifMc ? " if he's given an MC" : ""}`;
  const below = w.verdict.gaps.length ? " — BELOW MINIMUM" : "";
  const pendingNote = w.pendingCount && w.withPending.label !== w.verdict.label ? ` (+${w.pendingCount} pending would make it ${w.withPending.label})` : "";
  return `${when}: ${w.verdict.label} / min ${minimumLabel(opts.minimum)}${below}${pendingNote}`;
}
