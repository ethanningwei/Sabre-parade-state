import { sgtToInstant, toSgt } from "@/lib/parade/time";

// Time on the timeline. Pure: no I/O. Ports Sabre Bot's store.py helpers
// (covers, touches, overlaps, days_between) onto half-open instant ranges.
//
// Every range is [startAt, endAt). A date range D1..D2 is
// [D1 00:00 SGT, D2+1 00:00 SGT), so "touches a day" and "overlaps" need no
// end-of-day special cases: Sabre Bot's noon-sampling bug (an afternoon
// half-day touching no sampled moment) can't happen.

export interface Range {
  startAt: Date;
  /** null = open-ended */
  endAt: Date | null;
}

/** The longest range a day list will walk: a mistyped year must not loop for 30,000 days. */
export const MAX_DAYS = 31;

/** 'YYYY-MM-DD' plus n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in SGT, 'YYYY-MM-DD'. */
export const todaySgt = (now: Date = new Date()) => toSgt(now).date;

const at = (date: string, time = "0000") => sgtToInstant({ date, time });

/** D1..D2 inclusive, as whole days. */
export function dateRange(start: string, end: string): Range {
  return { startAt: at(start), endAt: at(addDays(end, 1)) };
}

/** One whole day. */
export const dayRange = (date: string): Range => dateRange(date, date);

/**
 * A range from dates and times as typed. 2359 on the end means "to the end of
 * the day" (Sabre Bot's whole-day tap), so it becomes the next midnight and the
 * last minute isn't lost.
 */
export function stampRange(startDate: string, startTime: string, endDate: string, endTime: string): Range {
  const endAt = endTime === "2359" ? at(addDays(endDate, 1)) : at(endDate, endTime);
  return { startAt: at(startDate, startTime), endAt };
}

const endMs = (r: Range) => r.endAt?.getTime() ?? Infinity;

/** Do two ranges share any instant? Touching ends ([a, b) and [b, c)) don't. */
export const overlaps = (a: Range, b: Range) => a.startAt.getTime() < endMs(b) && b.startAt.getTime() < endMs(a);

/** Is the range live at any point on that SGT day? */
export const touchesDay = (r: Range, date: string) => overlaps(r, dayRange(date));

/** Is the range live at this instant? */
export const activeAt = (r: Range, t: Date) => r.startAt.getTime() <= t.getTime() && t.getTime() < endMs(r);

/** Every SGT day the range touches, in order, at most `cap`. */
export function daysTouched(r: Range, cap = MAX_DAYS): string[] {
  const first = toSgt(r.startAt).date;
  const last = r.endAt ? toSgt(new Date(r.endAt.getTime() - 1)).date : null;
  const out: string[] = [];
  for (let d = first; out.length < cap && (last === null || d <= last); d = addDays(d, 1)) out.push(d);
  return out;
}

/** How many SGT days the range touches, uncapped (for "too long" checks). */
export function dayCount(r: Range): number {
  if (!r.endAt) return Infinity;
  const first = Date.parse(`${toSgt(r.startAt).date}T00:00:00Z`);
  const last = Date.parse(`${toSgt(new Date(r.endAt.getTime() - 1)).date}T00:00:00Z`);
  return Math.round((last - first) / 86_400_000) + 1;
}

// ------------------------------------------------------------------ labels

/** 'YYYY-MM-DD' -> '27/08' */
export const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** 'YYYY-MM-DD' -> '27/08/26' */
export const dayMonthYear = (date: string) => `${dayMonth(date)}/${date.slice(2, 4)}`;

/**
 * A range the way a person reads it: "27/08–29/08" for whole days,
 * "27/08 2100–29/08" when it starts mid-day, "27/08 0800–1700" within a day.
 * An end at midnight is shown as the day before, with no time.
 */
export function rangeLabel(r: Range, fmt: (date: string) => string = dayMonth): string {
  const s = toSgt(r.startAt);
  const from = fmt(s.date) + (s.time === "0000" ? "" : ` ${s.time}`);
  if (!r.endAt) return `from ${from}`;
  const e = toSgt(r.endAt);
  const endDate = e.time === "0000" ? toSgt(new Date(r.endAt.getTime() - 1)).date : e.date;
  const endTime = e.time === "0000" ? "" : e.time;
  if (endDate === s.date) {
    if (s.time === "0000" && !endTime) return fmt(s.date);
    return `${fmt(s.date)} ${s.time}–${endTime || "2359"}`;
  }
  return `${from}–${fmt(endDate)}${endTime ? ` ${endTime}` : ""}`;
}

// ------------------------------------------------------------------ form checks

export interface RangeInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/**
 * The two mistakes behind nearly every unusable row in Sabre Bot's sheets:
 * applying for something already over, and a range that ends before it starts.
 * Today is always allowed. Returns the range, or what's wrong with it.
 */
export function checkRange(input: RangeInput, today: string): { ok: true; range: Range } | { ok: false; error: string } {
  if (input.startDate < today) return { ok: false, error: `The start, ${dayMonthYear(input.startDate)}, is in the past. Tell your PS instead.` };
  if (input.endDate < today) return { ok: false, error: `The end, ${dayMonthYear(input.endDate)}, is in the past.` };
  if (input.endDate < input.startDate) return { ok: false, error: "The end can't be before the start." };
  const range = stampRange(input.startDate, input.startTime, input.endDate, input.endTime);
  if (range.endAt && range.endAt <= range.startAt) return { ok: false, error: "The end has to be after the start." };
  return { ok: true, range };
}
