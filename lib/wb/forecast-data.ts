import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp, coy, subunit } from "@/lib/db/schema";
import { loadSnapshot } from "@/lib/data/snapshot";
import { toSgt } from "@/lib/parade/time";
import { wbAssignment, wbMinManning, wbRecord, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import {
  forecastGrid,
  manningLine,
  manningOf,
  nextDays,
  snapshotFor,
  verdict,
  worstDay,
  worstDayOf,
  type AssignmentRow,
  type CampManning,
  type ForecastInput,
  type GridRow,
  type TimelineRow,
} from "@/lib/wb/domain/forecast";
import { campAccess, type GrantRow } from "@/lib/wb/domain/access";
import { minimumLabel, onShiftAt, overrideLabel, overrideWindow, stintAround, usable, type Minimum, type ShiftPattern } from "@/lib/wb/domain/shifts";
import { addDays, dayMonth, dayRange, todaySgt, type Range } from "@/lib/wb/domain/timeline";
import { memberLabel, type Db, type RecordView } from "@/lib/wb/records";

// Shifts, minimum manning and the forecast: the reads. The rules are pure
// (lib/wb/domain/shifts.ts, forecast.ts); this loads what they need. Writes
// (saving a pattern, a HOTO) are in lib/wb/shifts.ts. Kept apart so the
// decision core can draw a card's manning line without importing itself.

export const FORECAST_DAYS = 14;

// ------------------------------------------------------------------ reads

export interface CampInfo {
  id: string;
  name: string;
  /** physical camp: "SFT" for SFT A and SFT B */
  post: string;
  subunitId: string;
  subunitName: string;
  isHq: boolean;
  onShift: boolean;
}

/** Every camp in parade-state order. */
export async function campsInfo(tx: Db = db): Promise<CampInfo[]> {
  const rows = await tx
    .select({ id: camp.id, name: camp.name, post: camp.post, subunitId: subunit.id, subunitName: subunit.name, isHq: subunit.isHq, onShift: camp.onShift })
    .from(camp)
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder));
  return rows.map((r) => ({ ...r, post: r.post ?? r.name }));
}

export interface PostInfo {
  post: string;
  subunitId: string;
  subunitName: string;
  isHq: boolean;
  teams: CampInfo[];
}

/** Camps grouped into physical camps, in order. */
export function postsOf(camps: readonly CampInfo[]): PostInfo[] {
  const out: PostInfo[] = [];
  for (const c of camps) {
    const p = out.find((x) => x.post === c.post && x.subunitId === c.subunitId);
    if (p) p.teams.push(c);
    else out.push({ post: c.post, subunitId: c.subunitId, subunitName: c.subunitName, isHq: c.isHq, teams: [c] });
  }
  return out;
}

type PatternRow = typeof wbShiftPattern.$inferSelect;
export const toPattern = (r: PatternRow): ShiftPattern => ({
  campId: r.campId,
  kind: r.kind,
  onDays: r.onDays,
  offDays: r.offDays,
  anchorDate: r.anchorDate,
  hotoTime: r.hotoTime,
  weekdayMask: r.weekdayMask,
  holidaysOff: r.holidaysOff,
  bothOnAllowed: r.bothOnAllowed,
});

export async function loadPatterns(tx: Db = db): Promise<Map<string, ShiftPattern>> {
  const rows = await tx.select().from(wbShiftPattern);
  return new Map(rows.map((r) => [r.campId, toPattern(r)]));
}

type MinRow = typeof wbMinManning.$inferSelect;
const toMinimum = (r: MinRow): Minimum =>
  r.gc !== null && r.stCbt !== null && r.stSvc !== null ? { total: r.total, roles: { GC: r.gc, "ST CBT": r.stCbt, "ST SVC": r.stSvc } } : { total: r.total, roles: null };

export async function loadMinimums(tx: Db = db): Promise<Map<string, Minimum>> {
  const rows = await tx.select().from(wbMinManning);
  return new Map(rows.map((r) => [r.campId, toMinimum(r)]));
}

/** Live timeline rows that touch a range (pending included; the forecast decides what counts). */
async function timelineRows(range: Range, tx: Db = db): Promise<TimelineRow[]> {
  return tx
    .select({
      id: wbRecord.id,
      personId: wbRecord.personId,
      kind: wbRecord.kind,
      state: wbRecord.state,
      startAt: wbRecord.startAt,
      endAt: wbRecord.endAt,
      detail: wbRecord.detail,
    })
    .from(wbRecord)
    .where(
      and(
        inArray(wbRecord.state, ["PENDING", "APPROVED", "RECORDED"]),
        lt(wbRecord.startAt, range.endAt ?? new Date(8.64e15)),
        or(isNull(wbRecord.endAt), gt(wbRecord.endAt, range.startAt)),
      ),
    );
}

/** Live (ACTIVE) Extra/RF/SOL that touch a range. */
export async function assignmentRows(range: Range, tx: Db = db): Promise<AssignmentRow[]> {
  return tx
    .select({
      id: wbAssignment.id,
      personId: wbAssignment.personId,
      type: wbAssignment.type,
      campId: wbAssignment.campId,
      startAt: wbAssignment.startAt,
      endAt: wbAssignment.endAt,
    })
    .from(wbAssignment)
    .where(and(eq(wbAssignment.state, "ACTIVE"), lt(wbAssignment.startAt, range.endAt ?? new Date(8.64e15)), gt(wbAssignment.endAt, range.startAt)));
}

/** The coy these camps belong to (the forecast works one coy's parade state at a time). */
async function coyOf(campIds: readonly string[]) {
  const [row] = await db.select({ c: coy }).from(coy).innerJoin(camp, eq(camp.coyId, coy.id)).where(inArray(camp.id, [...campIds])).limit(1);
  return row?.c ?? null;
}

/**
 * Everything the forecast needs for a range of days: the v1 parade state now
 * of the coy that owns these camps, the patterns, and the timeline.
 */
export async function forecastInput(range: Range, campIds: readonly string[], now: Date = new Date()): Promise<ForecastInput> {
  const owner = await coyOf(campIds);
  if (!owner) throw new Error("No coy for those camps");
  const [base, patterns, records, assignments] = await Promise.all([loadSnapshot(owner), loadPatterns(), timelineRows(range), assignmentRows(range)]);
  return { base, now, patterns, records, assignments };
}

// ------------------------------------------------------------------ the card's line

/** Requests whose card carries a manning line. MA and events are facts, not requests. */
const MANNING_KINDS = ["AL", "OL", "OFF", "RSI", "RSO"];

/**
 * "SLR on 14/10 (worst day): 0:3:3 / min 1:4:3 — BELOW MINIMUM", or null for
 * a card that has none. Never throws: a card without the line is better than
 * no card.
 */
export async function manningFor(r: RecordView, now: Date = new Date()): Promise<string | null> {
  if (!MANNING_KINDS.includes(r.kind) || (r.state !== "PENDING" && r.state !== "APPROVED")) return null;
  try {
    const [[sub], minimums] = await Promise.all([db.select({ isHq: subunit.isHq }).from(subunit).where(eq(subunit.id, r.subunitId)), loadMinimums()]);
    if (!sub || sub.isHq) return null;
    const minimum = minimums.get(r.campId) ?? null;
    if (!minimum) return manningLine({ name: r.campName, isHq: false }, null, { minimum });
    const input = await forecastInput(r, [r.campId], now);
    const w = worstDay(input, { ...r, campId: r.campId }, minimum);
    return manningLine({ name: r.campName, isHq: false }, w, { minimum, ifMc: r.kind === "RSI" || r.kind === "RSO" }) || null;
  } catch (e) {
    console.error("wb manning:", e);
    return null;
  }
}

/**
 * A camp's worst day over a range, as a line: "SFT A on 14/10 (worst day):
 * 1:3:3 / min 1:4:3 — BELOW MINIMUM". What a commander needs when a man is
 * sent away from it. Null for COY HQ or on any failure.
 */
export async function campManningLine(campId: string, range: Range, now: Date = new Date()): Promise<string | null> {
  try {
    const [camps, minimums] = await Promise.all([campsInfo(), loadMinimums()]);
    const c = camps.find((x) => x.id === campId);
    if (!c || c.isHq) return null;
    const minimum = minimums.get(campId) ?? null;
    if (!minimum) return manningLine(c, null, { minimum });
    const input = await forecastInput(range, [campId], now);
    return manningLine(c, worstDayOf(input, campId, range, minimum), { minimum }) || null;
  } catch (e) {
    console.error("wb manning:", e);
    return null;
  }
}

// ------------------------------------------------------------------ the grid and the day

/** The camps a member may forecast: their platoon's (PC/PS) or all (OC/2IC/CSM). */
export function forecastScope(grants: readonly GrantRow[], camps: readonly CampInfo[]): CampInfo[] {
  return camps.filter((c) => campAccess({ grants }, { subunitId: c.subunitId, campId: c.id }).forecast);
}

export async function grid(campIds: readonly string[], from = todaySgt(), days = FORECAST_DAYS, now: Date = new Date()): Promise<GridRow[]> {
  const dates = nextDays(from, days);
  const range = { startAt: dayRange(dates[0]).startAt, endAt: dayRange(dates.at(-1)!).endAt };
  const [input, minimums] = await Promise.all([forecastInput(range, campIds, now), loadMinimums()]);
  return forecastGrid(input, campIds, dates, minimums);
}

export interface DayCamp {
  info: CampInfo;
  /** on approved records */
  manning: CampManning;
  /** who's away, pending requests included and flagged */
  away: CampManning["away"];
  minimum: Minimum | null;
  label: string;
  short: boolean;
  /** "on until 13/10 2100", "off · next on 16/10 2100", "Mon–Fri", "no pattern" */
  shiftNote: string;
}

/** One day for some camps: on shift or not, strength against the minimum, who's away. Statuses are on the man's own pages, not here (2026-10-27). */
export async function dayView(campIds: readonly string[], date: string, now: Date = new Date()): Promise<DayCamp[]> {
  const range = dayRange(date);
  const [input, minimums, camps] = await Promise.all([forecastInput(range, campIds, now), loadMinimums(), campsInfo()]);
  const manning = new Map(manningOf(snapshotFor(input, range)).map((m) => [m.campId, m]));
  // the away list includes pending requests (flagged); the strength doesn't
  const withPending = new Map(manningOf(snapshotFor(input, range, { pending: true })).map((m) => [m.campId, m]));
  const pivot = date === todaySgt(now) ? now : range.startAt;
  const out: DayCamp[] = [];
  for (const id of campIds) {
    const info = camps.find((c) => c.id === id);
    const m = manning.get(id);
    if (!info || !m) continue;
    const minimum = minimums.get(id) ?? null;
    const v = verdict(m, minimum);
    const p = input.patterns.get(id);
    out.push({
      info,
      manning: m,
      away: withPending.get(id)?.away ?? m.away,
      minimum,
      label: v.label,
      short: v.gaps.length > 0,
      shiftNote: shiftNote(p, pivot),
    });
  }
  return out;
}

/** A pattern in a few words, as of an instant. */
export function shiftNote(p: ShiftPattern | undefined, t: Date): string {
  if (!p || !usable(p)) return "No pattern set";
  if (p.kind === "ALWAYS") return "Always on";
  if (p.kind === "WEEKLY") return p.weekdayMask === 31 ? `Mon–Fri${p.holidaysOff ? ", public holidays off" : ""}` : "Weekly";
  const s = stintAround(p, t)!;
  const fmt = (d: Date) => `${dayMonth(toSgt(d).date)} ${toSgt(d).time}`;
  return s.startAt <= t ? `On until ${fmt(s.endAt!)}` : `Off · next on ${fmt(s.startAt)}`;
}

export function patternSummary(p: ShiftPattern | undefined): string {
  if (!p || !usable(p)) return "No pattern set";
  if (p.kind !== "CYCLE") return shiftNote(p, new Date());
  return `${p.onDays} in ${p.offDays} out · HOTO ${p.hotoTime}${p.bothOnAllowed ? " · both teams may stand" : ""}`;
}

// ------------------------------------------------------------------ the evening digest

/** "• SLR: 0:4:3 / min 1:4:3" for each camp below its minimum tomorrow, by platoon. Approved records only. */
export async function shortTomorrow(now: Date = new Date()): Promise<Map<string, { name: string; lines: string[] }>> {
  const date = addDays(todaySgt(now), 1);
  const out = new Map<string, { name: string; lines: string[] }>();
  const minimums = await loadMinimums();
  if (!minimums.size) return out;
  // one coy's parade state at a time
  const coys = await db.selectDistinct({ id: camp.coyId }).from(camp).where(inArray(camp.id, [...minimums.keys()]));
  for (const c of coys) {
    const [first] = await db.select({ id: camp.id }).from(camp).where(eq(camp.coyId, c.id)).limit(1);
    const input = await forecastInput(dayRange(date), [first.id], now);
    for (const m of manningOf(snapshotFor(input, dayRange(date)))) {
      const minimum = minimums.get(m.campId);
      if (!minimum || m.isHq) continue;
      const v = verdict(m, minimum);
      if (!v.gaps.length) continue;
      const d = out.get(m.subunitId) ?? { name: m.subunitName, lines: [] };
      d.lines.push(`• ${m.campName}: ${v.label} / min ${minimumLabel(minimum)}`);
      out.set(m.subunitId, d);
    }
  }
  return out;
}


// ------------------------------------------------------------------ weekday camps (Admin › Projection)

export interface WeekdayCamp {
  id: string;
  name: string;
  subunitName: string;
  /** what the parade state says now */
  onShift: boolean;
  /** what the pattern says now */
  patternOn: boolean | null;
  /** the override in force or to come, if any */
  override: { id: string; label: string } | null;
  /** the two overrides on offer: on, and off */
  offers: { on: boolean; label: string }[];
}

/** Every camp with a WEEKLY pattern (the RG camps, COY HQ), in roster order, for the admin's override. */
export async function weekdayCamps(now: Date = new Date()): Promise<WeekdayCamp[]> {
  const rows = await db
    .select({ p: wbShiftPattern, name: camp.name, subunitName: subunit.name, onShift: camp.onShift })
    .from(wbShiftPattern)
    .innerJoin(camp, eq(camp.id, wbShiftPattern.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(eq(wbShiftPattern.kind, "WEEKLY"))
    .orderBy(subunit.sortOrder, camp.sortOrder);
  if (!rows.length) return [];
  const overrides = await db
    .select()
    .from(wbShiftOverride)
    .where(and(isNull(wbShiftOverride.clearedAt), gt(wbShiftOverride.untilAt, now), inArray(wbShiftOverride.campId, rows.map((r) => r.p.campId))));
  return Promise.all(
    rows.map(async (r) => {
      const p = toPattern(r.p);
      const o = overrides.find((x) => x.campId === r.p.campId);
      const offers = [true, false].flatMap((on) => {
        const w = overrideWindow(p, now, on);
        return w ? [{ on, label: overrideLabel(w, on, now) }] : [];
      });
      return {
        id: r.p.campId,
        name: r.name,
        subunitName: r.subunitName,
        onShift: r.onShift,
        patternOn: onShiftAt(p, now),
        override: o
          ? { id: o.id, label: `${overrideLabel({ startAt: o.fromAt, endAt: o.untilAt }, o.on, now).replace(/^Keep/, "Kept")}${o.by ? ` · ${await memberLabel(o.by)}` : ""}` }
          : null,
        offers,
      };
    }),
  );
}
