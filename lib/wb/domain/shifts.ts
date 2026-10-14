import { sgtToInstant, toSgt } from "@/lib/parade/time";
import { holidayOn } from "./holidays";
import { roleOf, ROLES_GUARDROOM } from "./roles";
import { addDays, dayMonth, dayRange, type Range } from "./timeline";

// Which team stands where, and what a guardroom can't go under. Pure: no I/O.
//
// Sabre Bot had no cycle for a pair (the HOTO flipped a cell in the sheet);
// here a pair runs on a fixed cycle that a HOTO confirms or re-anchors
// (decided 2026-10-12). An RG camp is on Monday to Friday, which is a fact
// about the calendar, as Sabre Bot already worked it out.

export const WB_SHIFT_KINDS = ["CYCLE", "WEEKLY", "ALWAYS"] as const;
export type WbShiftKind = (typeof WB_SHIFT_KINDS)[number];

const DAY_MS = 86_400_000;

export interface ShiftPattern {
  campId: string;
  kind: WbShiftKind;
  /** CYCLE: days on, then days off */
  onDays: number;
  offDays: number;
  /** CYCLE: a day this team's stint starts, at hotoTime */
  anchorDate: string | null;
  /** HHMM: when the stint flips (CYCLE) */
  hotoTime: string;
  /** WEEKLY: bit 0 = Monday … bit 6 = Sunday */
  weekdayMask: number;
  /** WEEKLY: a public holiday is a day off */
  holidaysOff: boolean;
  /** a pair whose two teams may stand at once (SRF) */
  bothOnAllowed: boolean;
}

/** Monday to Friday. */
export const WEEKDAYS = 0b0011111;
export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** 0 = Monday … 6 = Sunday, for an SGT date. */
export const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

const anchorAt = (p: ShiftPattern) => sgtToInstant({ date: p.anchorDate!, time: p.hotoTime });
const periodMs = (p: ShiftPattern) => (p.onDays + p.offDays) * DAY_MS;

/** A pattern that can say anything: a CYCLE needs an anchor and a positive period. */
export function usable(p: ShiftPattern): boolean {
  if (p.kind !== "CYCLE") return true;
  return !!p.anchorDate && p.onDays > 0 && p.offDays >= 0 && p.onDays + p.offDays > 0;
}

/** The stint (on interval) of a CYCLE team that starts at or before t. */
function stintBefore(p: ShiftPattern, t: number): { start: number; end: number } {
  const a = anchorAt(p).getTime();
  const k = Math.floor((t - a) / periodMs(p));
  const start = a + k * periodMs(p);
  return { start, end: start + p.onDays * DAY_MS };
}

function weeklyOnDay(p: ShiftPattern, date: string): boolean {
  if (!(p.weekdayMask & (1 << weekdayOf(date)))) return false;
  return !(p.holidaysOff && holidayOn(date));
}

/** Is this team on at the instant t? Unusable patterns say nothing (null). */
export function onShiftAt(p: ShiftPattern, t: Date): boolean | null {
  if (!usable(p)) return null;
  if (p.kind === "ALWAYS") return true;
  if (p.kind === "WEEKLY") return weeklyOnDay(p, toSgt(t).date);
  const s = stintBefore(p, t.getTime());
  return t.getTime() < s.end;
}

/**
 * Is this team on at any moment of the range? A day is a range, so a pair
 * that flips at 2100 is on for both of its handover days: SFT B mounting at
 * 2100 on 10/10 stands on 10, 11, 12 and 13/10 (four days for three nights),
 * and SRF's two teams both stand on their changeover Monday.
 */
export function onDuring(p: ShiftPattern, r: Range): boolean | null {
  if (!usable(p)) return null;
  if (p.kind === "ALWAYS") return true;
  const from = r.startAt.getTime();
  const to = r.endAt?.getTime() ?? from + 366 * DAY_MS;
  if (p.kind === "WEEKLY") {
    for (let d = toSgt(r.startAt).date; dayRange(d).startAt.getTime() < to; d = addDays(d, 1)) if (weeklyOnDay(p, d)) return true;
    return false;
  }
  // the stint live at the start, or any stint starting inside the range
  for (let s = stintBefore(p, from); s.start < to; s = { start: s.start + periodMs(p), end: s.end + periodMs(p) }) {
    if (s.end > from) return true;
  }
  return false;
}

export const onDay = (p: ShiftPattern, date: string) => onDuring(p, dayRange(date));

// ------------------------------------------------------------------ weekday camps (projector, 2026-10-14)

/** The next SGT midnight after t when a WEEKLY camp's day flips on↔off, or null if it doesn't within a year. */
export function nextFlipAt(p: ShiftPattern, t: Date): Date | null {
  if (p.kind !== "WEEKLY") return null;
  const today = toSgt(t).date;
  const on = weeklyOnDay(p, today);
  for (let d = addDays(today, 1), i = 0; i < 366; d = addDays(d, 1), i++) if (weeklyOnDay(p, d) !== on) return dayRange(d).startAt;
  return null;
}

/**
 * An admin keeping a weekday camp on (or off) against its pattern: the stretch
 * where the pattern says otherwise, from now if it already does (a Saturday:
 * until Monday), else the next one (on a Friday, "keep it on" covers the
 * weekend). Null for a camp that isn't WEEKLY or never flips.
 */
export function overrideWindow(p: ShiftPattern, t: Date, on: boolean): Range | null {
  if (p.kind !== "WEEKLY") return null;
  const startAt = weeklyOnDay(p, toSgt(t).date) === on ? nextFlipAt(p, t) : t;
  const endAt = startAt && nextFlipAt(p, startAt);
  return startAt && endAt ? { startAt, endAt } : null;
}

/** "Keep on through Sun 18/10" (from now), "Keep off today", or "Keep on Sat 17/10–Sun 18/10" (a stretch to come). */
export function overrideLabel(w: Range, on: boolean, now: Date): string {
  const day = (date: string) => `${WEEKDAY_NAMES[weekdayOf(date)]} ${dayMonth(date)}`;
  const verb = on ? "Keep on" : "Keep off";
  const last = addDays(toSgt(w.endAt!).date, -1);
  if (w.startAt.getTime() <= now.getTime()) return last === toSgt(now).date ? `${verb} today` : `${verb} through ${day(last)}`;
  const first = toSgt(w.startAt).date;
  return first === last ? `${verb} ${day(first)}` : `${verb} ${day(first)}–${day(last)}`;
}

export interface ShiftOverride {
  on: boolean;
  fromAt: Date;
  untilAt: Date;
}

/** What a weekday camp should be at t: an admin's override in force, else its pattern. */
export function weeklyWant(p: ShiftPattern, overrides: readonly ShiftOverride[], t: Date): boolean | null {
  const o = overrides.find((x) => x.fromAt.getTime() <= t.getTime() && t.getTime() < x.untilAt.getTime());
  return o ? o.on : onShiftAt(p, t);
}

/** The current or next stint of a CYCLE team, for "on until 16/10 2100" / "next on 16/10 2100". */
export function stintAround(p: ShiftPattern, t: Date): Range | null {
  if (p.kind !== "CYCLE" || !usable(p)) return null;
  const s = stintBefore(p, t.getTime());
  const next = t.getTime() < s.end ? s : { start: s.start + periodMs(p), end: s.end + periodMs(p) };
  return { startAt: new Date(next.start), endAt: new Date(next.end) };
}

/** The other team's pattern for a pair: same cycle, starting when this one stops. */
export function partnerPattern(p: ShiftPattern, partnerCampId: string): ShiftPattern {
  return { ...p, campId: partnerCampId, anchorDate: p.anchorDate ? addDays(p.anchorDate, p.onDays) : null };
}

/**
 * What's wrong with a pair, or null. Without both-on, exactly one team stands
 * at every instant; with it (SRF) at least one does. Checked across one whole
 * cycle at the hour, plus either side of each flip.
 */
export function pairProblem(a: ShiftPattern, b: ShiftPattern, names: [string, string]): string | null {
  if (!usable(a) || !usable(b)) return null;
  const both = a.bothOnAllowed && b.bothOnAllowed;
  const start = a.kind === "CYCLE" && a.anchorDate ? anchorAt(a).getTime() : Date.UTC(2026, 0, 5);
  const span = Math.max(a.kind === "CYCLE" ? periodMs(a) : 7 * DAY_MS, b.kind === "CYCLE" ? periodMs(b) : 7 * DAY_MS);
  for (let t = start - 60_000; t < start + span; t += 30 * 60_000) {
    const at = new Date(t);
    const [x, y] = [onShiftAt(a, at), onShiftAt(b, at)];
    if (!x && !y) return `Nobody would be on at ${names[0].replace(/\s+[A-Z]$/, "")} on ${toSgt(at).date} ${toSgt(at).time}.`;
    if (x && y && !both) return `${names[0]} and ${names[1]} would both be on at ${toSgt(at).date} ${toSgt(at).time}.`;
  }
  return null;
}

// ------------------------------------------------------------------ HOTO

/** How far a HOTO may be from the pattern's flip and still confirm it. */
export const HOTO_TOLERANCE_MS = 6 * 60 * 60 * 1000;

export interface Hoto {
  /** true: this team took over; false: it handed over */
  on: boolean;
  at: Date;
}

export type HotoEffect =
  | { matched: true; expected: Date }
  | { matched: false; expected: Date | null; anchorDate: string };

/** The day whose hotoTime is closest to t. */
function nearestFlip(hotoTime: string, t: Date): Date {
  const d = toSgt(t).date;
  const options = [-1, 0, 1].map((n) => sgtToInstant({ date: addDays(d, n), time: hotoTime }));
  return options.reduce((best, x) => (Math.abs(x.getTime() - t.getTime()) < Math.abs(best.getTime() - t.getTime()) ? x : best));
}

/**
 * A HOTO against the pattern. Within HOTO_TOLERANCE_MS of the flip the
 * pattern expected, it's a confirmation. Otherwise the cycle moves so that
 * this team's stint starts (took over) or ends (handed over) at the HOTO
 * time nearest the moment it was logged, and the PS is told.
 */
export function hotoEffect(p: ShiftPattern, h: Hoto): HotoEffect {
  const t = h.at.getTime();
  let expected: Date | null = null;
  if (usable(p) && p.kind === "CYCLE") {
    // the flip of the right kind nearest t
    const s = stintBefore(p, t);
    const edges = h.on ? [s.start, s.start + periodMs(p)] : [s.end, s.end - periodMs(p)];
    const near = edges.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));
    expected = new Date(near);
    if (Math.abs(near - t) <= HOTO_TOLERANCE_MS) return { matched: true, expected };
  }
  const flip = nearestFlip(p.hotoTime, h.at);
  const start = toSgt(flip).date;
  return { matched: false, expected, anchorDate: h.on ? start : addDays(start, -p.onDays) };
}

// ------------------------------------------------------------------ minimum manning

export type GuardRole = (typeof ROLES_GUARDROOM)[number];

/** What a guardroom can't go under: "1:4:3" (GC:ST CBT:ST SVC), or a bare total. */
export interface Minimum {
  total: number;
  /** null for a bare number */
  roles: Record<GuardRole, number> | null;
}

/**
 * The cell, or null if it holds nothing usable (Sabre Bot's parse_minimum).
 * A wrong floor is worse than no floor, because it's the one a commander acts on.
 */
export function parseMinimum(raw: string | null | undefined): Minimum | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) {
    const parts = text.split(":").map((x) => x.trim());
    if (parts.length !== ROLES_GUARDROOM.length || !parts.every((x) => /^\d{1,3}$/.test(x))) return null;
    const roles = Object.fromEntries(ROLES_GUARDROOM.map((r, i) => [r, Number(parts[i])])) as Record<GuardRole, number>;
    return { total: parts.reduce((n, x) => n + Number(x), 0), roles };
  }
  return /^\d{1,3}$/.test(text) ? { total: Number(text), roles: null } : null;
}

/** "1:4:3", the same shape a strength is printed in, so the two read against each other. */
export const minimumLabel = (m: Minimum) => (m.roles ? ROLES_GUARDROOM.map((r) => m.roles![r]).join(":") : String(m.total));

export interface Strength {
  present: number;
  byRole: Record<GuardRole, number>;
  /** people whose roster role isn't a guardroom role: per-role claims become a guess */
  unknown: number;
}

/** Count heads by guardroom role (roleOf reads "GUARD COMM" as GC). */
export function strengthOf(roles: readonly string[]): Strength {
  const byRole = { GC: 0, "ST CBT": 0, "ST SVC": 0 } as Record<GuardRole, number>;
  let unknown = 0;
  for (const raw of roles) {
    const r = roleOf(raw) as GuardRole;
    if (r in byRole) byRole[r]++;
    else unknown++;
  }
  return { present: roles.length, byRole, unknown };
}

/** "0:4:3", or a bare head count when roles can't be trusted. */
export const strengthLabel = (s: Strength, m: Minimum | null) =>
  m?.roles && !s.unknown ? ROLES_GUARDROOM.map((r) => s.byRole[r]).join(":") : String(s.present);

export interface Gap {
  /** null: the total, which is all a bare number (or a roster with role gaps) can say */
  role: GuardRole | null;
  short: number;
}

/**
 * Each floor this strength misses (Sabre Bot's Minimum.gaps). One person with
 * no guardroom role could be any of the three, so per-role claims fall back
 * to the total rather than report a full guardroom as short.
 */
export function gaps(m: Minimum, s: Strength): Gap[] {
  if (m.roles && !s.unknown) {
    return ROLES_GUARDROOM.filter((r) => s.byRole[r] < m.roles![r]).map((r) => ({ role: r, short: m.roles![r] - s.byRole[r] }));
  }
  return s.present < m.total ? [{ role: null, short: m.total - s.present }] : [];
}

export const shortfall = (g: readonly Gap[]) => g.reduce((n, x) => n + x.short, 0);
