import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp, subunit } from "@/lib/db/schema";
import { getCoy, loadSnapshot } from "@/lib/data/snapshot";
import { toSgt } from "@/lib/parade/time";
import { wbMinManning, wbRecord, wbShiftPattern } from "@/lib/wb/db/schema";
import {
  forecastGrid,
  manningLine,
  manningOf,
  nextDays,
  snapshotFor,
  verdict,
  worstDay,
  type CampManning,
  type ForecastInput,
  type GridRow,
  type TimelineRow,
} from "@/lib/wb/domain/forecast";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { canForecast } from "@/lib/wb/domain/rules";
import { minimumLabel, stintAround, usable, type Minimum, type ShiftPattern } from "@/lib/wb/domain/shifts";
import { addDays, dayMonth, dayRange, rangeLabel, todaySgt, type Range } from "@/lib/wb/domain/timeline";
import type { Db, RecordView } from "@/lib/wb/records";

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
const toPattern = (r: PatternRow): ShiftPattern => ({
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

/** Everything the forecast needs for a range of days: the v1 parade state now, the patterns, the timeline. */
export async function forecastInput(range: Range, now: Date = new Date()): Promise<ForecastInput> {
  const [base, patterns, records] = await Promise.all([getCoy().then(loadSnapshot), loadPatterns(), timelineRows(range)]);
  return { base, now, patterns, records };
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
    const input = await forecastInput(r, now);
    const w = worstDay(input, { ...r, campId: r.campId }, minimum);
    return manningLine({ name: r.campName, isHq: false }, w, { minimum, ifMc: r.kind === "RSI" || r.kind === "RSO" }) || null;
  } catch (e) {
    console.error("wb manning:", e);
    return null;
  }
}

// ------------------------------------------------------------------ the grid and the day

/** The camps a member may forecast: their platoon's (PC/PS) or all (OC/2IC/CSM). */
export function forecastScope(grants: readonly GrantRow[], camps: readonly CampInfo[]): CampInfo[] {
  return camps.filter((c) => canForecast(grants, { subunitId: c.subunitId, campId: c.id }));
}

export async function grid(campIds: readonly string[], from = todaySgt(), days = FORECAST_DAYS, now: Date = new Date()): Promise<GridRow[]> {
  const dates = nextDays(from, days);
  const range = { startAt: dayRange(dates[0]).startAt, endAt: dayRange(dates.at(-1)!).endAt };
  const [input, minimums] = await Promise.all([forecastInput(range, now), loadMinimums()]);
  return forecastGrid(input, campIds, dates, minimums);
}

export interface DayCamp {
  info: CampInfo;
  manning: CampManning;
  minimum: Minimum | null;
  label: string;
  short: boolean;
  /** "on until 13/10 2100", "off · next on 16/10 2100", "Mon–Fri", "no pattern" */
  shiftNote: string;
  statuses: { personId: string; rank: string; name: string; what: string }[];
}

/** One day for some camps: on shift or not, strength against the minimum, who's away and who's on status. */
export async function dayView(campIds: readonly string[], date: string, now: Date = new Date()): Promise<DayCamp[]> {
  const range = dayRange(date);
  const [input, minimums, camps] = await Promise.all([forecastInput(range, now), loadMinimums(), campsInfo()]);
  const built = snapshotFor(input, range);
  const manning = new Map(manningOf(built).map((m) => [m.campId, m]));
  const people = new Map(input.base.subunits.flatMap((s) => s.camps.flatMap((c) => c.people.map((p) => [p.id, { ...p, campId: c.id }] as const))));
  // statuses (light duty) keep a man present, so they're listed apart
  const statusRows = input.records.filter((r) => r.kind === "STATUS" && r.state === "RECORDED");
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
      minimum,
      label: v.label,
      short: v.gaps.length > 0,
      shiftNote: shiftNote(p, pivot),
      statuses: statusRows
        .filter((r) => people.get(r.personId)?.campId === id)
        .map((r) => {
          const who = people.get(r.personId)!;
          return { personId: r.personId, rank: who.rank, name: who.name, what: `${r.detail || "STATUS"} · ${rangeLabel(r)}` };
        }),
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
  if (p.kind === "ALWAYS") return "Always on";
  if (p.kind === "WEEKLY") return shiftNote(p, new Date());
  return `${p.onDays} in ${p.offDays} out · flips ${p.hotoTime} · on from ${dayMonth(p.anchorDate!)}/${p.anchorDate!.slice(2, 4)}`;
}

// ------------------------------------------------------------------ the evening digest

/** "• SLR: 0:4:3 / min 1:4:3" for each camp below its minimum tomorrow, by platoon. Approved records only. */
export async function shortTomorrow(now: Date = new Date()): Promise<Map<string, { name: string; lines: string[] }>> {
  const date = addDays(todaySgt(now), 1);
  const out = new Map<string, { name: string; lines: string[] }>();
  const minimums = await loadMinimums();
  if (!minimums.size) return out;
  const input = await forecastInput(dayRange(date), now);
  for (const m of manningOf(snapshotFor(input, dayRange(date)))) {
    const minimum = minimums.get(m.campId);
    if (!minimum || m.isHq) continue;
    const v = verdict(m, minimum);
    if (!v.gaps.length) continue;
    const d = out.get(m.subunitId) ?? { name: m.subunitName, lines: [] };
    d.lines.push(`• ${m.campName}: ${v.label} / min ${minimumLabel(minimum)}`);
    out.set(m.subunitId, d);
  }
  return out;
}

