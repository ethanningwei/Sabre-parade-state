import { z } from "zod";
import { parseHhmm } from "@/lib/parade/time";
import { actorOf, Refusal } from "@/lib/wb/core";
import type { NewRecord } from "@/lib/wb/decide";
import { eventDetail, leaveDetail, overseasWhere, reasonText } from "@/lib/wb/domain/describe";
import { AL_PLACES, LEAVE_REASONS } from "@/lib/wb/domain/roles";
import { isAbsentKind, leaveRefusal } from "@/lib/wb/domain/rules";
import { checkRange, dayCount, dayRange, daysTouched, MAX_DAYS, todaySgt, type Range } from "@/lib/wb/domain/timeline";
import type { Acting } from "@/lib/wb/write";

// What the Mini App's forms send, checked and turned into what a Write takes.
// Plain functions (no session, no database), so the server actions are only
// sign-in, these, and the Write; a bad form throws Refusal, which run() shows.

/** The Mini App's signed-in member, acting. */
export const miniApp = (m: Parameters<typeof actorOf>[0]): Acting => ({ actor: actorOf(m), via: "MINIAPP" });

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
export const zTime = z
  .string()
  .transform((t) => parseHhmm(t))
  .refine((t): t is string => t !== null, "Give the time as HHMM, e.g. 2100.");
export const zText = (what: string, max = 100) => z.string().trim().min(1, `Say ${what}.`).max(max);
export const zId = z.uuid();

export const rangeShape = { startDate: zDate, startTime: zTime, endDate: zDate, endTime: zTime };
export const rangeInput = z.object(rangeShape);
type RangeFields = { startDate: string; startTime: string; endDate: string; endTime: string };

/** A range from the form: in order, not over, and at most `maxDays` days. */
export function rangeFrom(input: RangeFields, maxDays?: number, today = todaySgt()): Range {
  const r = checkRange(input, today);
  if (!r.ok) throw new Refusal(r.error);
  if (maxDays && dayCount(r.range) > maxDays) throw new Refusal(`Apply for at most ${maxDays} days at a time. Split it into two.`);
  return r.range;
}

/** Extra/RF/SOL and RF requests: ends in the future, at most `maxDays` days. */
export function dutyRangeFrom(input: RangeFields, maxDays: number, now = new Date()): Range & { endAt: Date } {
  const r = checkRange(input, todaySgt(now));
  if (!r.ok) throw new Refusal(r.error);
  if (r.range.endAt!.getTime() <= now.getTime()) throw new Refusal("The end has already passed.");
  if (dayCount(r.range) > maxDays) throw new Refusal(`At most ${maxDays} days at a time. Split it into two.`);
  return r.range as Range & { endAt: Date };
}

/** A trooper's own record, before it's his: the Write adds who, and SELF. */
export type OwnRecord = Omit<NewRecord, "personId" | "memberId" | "createdVia">;

// ------------------------------------------------------------------ leave and off

export const leaveInput = rangeInput.extend({
  kind: z.enum(["AL", "OL"]),
  days: z.array(zDate).max(MAX_DAYS),
  place: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default(""),
  reason: z.enum([...LEAVE_REASONS, "OTHER"], { message: "Say what it's for." }),
  reasonOther: z.string().trim().max(100).default(""),
});

/** AL or OL: dates, the days it costs (checked against his balance), where, and why. */
export function leaveFrom(raw: z.input<typeof leaveInput>, leaveLeft: number, today = todaySgt()): OwnRecord {
  const a = leaveInput.parse(raw);
  const r = rangeFrom(a, MAX_DAYS, today);
  const touched = new Set(daysTouched(r));
  const days = [...new Set(a.days)];
  if (days.some((d) => !touched.has(d))) throw new Refusal("Those days aren't all in the range. Go back and tick them again.");
  const refusal = leaveRefusal(days.length, leaveLeft);
  if (refusal) throw new Refusal(refusal);

  let where: string;
  if (a.kind === "AL") {
    if (!(AL_PLACES as readonly string[]).includes(a.place)) throw new Refusal("Annual leave is Singapore or Johor Bahru. Further is overseas leave.");
    where = a.place;
  } else {
    if (!a.city.trim() || !a.country.trim()) throw new Refusal("Say which city and country.");
    where = overseasWhere(a.city, a.country);
  }
  const why = reasonText(a.reason, a.reasonOther);
  if (!why) throw new Refusal("Say what it's for.");
  return { kind: a.kind, ...r, endAt: r.endAt!, absent: true, leaveDays: days.length, detail: leaveDetail(a.kind, where), location: where, reason: why };
}

/** Off: just the dates. */
export function offFrom(raw: z.input<typeof rangeInput>, today = todaySgt()): OwnRecord {
  const r = rangeFrom(rangeInput.parse(raw), MAX_DAYS, today);
  return { kind: "OFF", ...r, endAt: r.endAt!, absent: true, detail: "OFF" };
}

// ------------------------------------------------------------------ MA and report sick

export const maInput = z.object({ date: zDate, time: zTime, place: zText("where", 100) });

/** An MA: the day, the time, the place. Recorded, no approval; absent for the day. */
export function maFrom(raw: z.input<typeof maInput>, today = todaySgt()): OwnRecord {
  const a = maInput.parse(raw);
  if (a.date < today) throw new Refusal("The appointment is in the past. Tell your PS instead.");
  const r = dayRange(a.date);
  return { kind: "MA", ...r, endAt: r.endAt!, absent: true, detail: "MA", maTiming: a.time, location: a.place.toUpperCase() };
}

export const sickInput = z.object({
  where: z.enum(["RSI", "RSO"], { message: "Say where you're reporting sick." }),
  date: zDate,
  clinic: z.string().trim().max(100).default(""),
  symptoms: zText("what's wrong", 300),
});

/**
 * Report sick (ports Sabre Bot's SICK): in camp (RSI) or outside (RSO), the
 * day, the clinic for an RSO, and his symptoms for his commander. Neither is
 * an absence: only an MC or HL is.
 */
export function sickFrom(raw: z.input<typeof sickInput>, today = todaySgt()): OwnRecord {
  const a = sickInput.parse(raw);
  if (a.date < today) throw new Refusal("That day is over. Tell your PS instead.");
  if (a.where === "RSO" && !a.clinic) throw new Refusal("Say which clinic or hospital.");
  const r = dayRange(a.date);
  return {
    kind: a.where,
    ...r,
    endAt: r.endAt!,
    absent: isAbsentKind(a.where),
    detail: a.where,
    location: a.where === "RSO" ? a.clinic.toUpperCase() : "",
    reason: a.symptoms,
  };
}

// ------------------------------------------------------------------ events

export const eventInput = z.object({
  what: zText("what it is"),
  place: zText("where it is"),
  startDate: zDate,
  endDate: zDate,
  timeStart: zTime,
  timeEnd: zTime,
});

/** A course, brief, IPPT or anything else: its range and line. Over several days the hours are the daily ones. */
export function eventFrom(raw: z.input<typeof eventInput>, today = todaySgt()): OwnRecord {
  const a = eventInput.parse(raw);
  if (a.startDate === a.endDate && a.timeEnd <= a.timeStart) throw new Refusal(`It has to end after it starts: you gave ${a.timeStart} to ${a.timeEnd}.`);
  const r = rangeFrom({ startDate: a.startDate, startTime: a.timeStart, endDate: a.endDate, endTime: a.timeEnd }, undefined, today);
  return {
    kind: "EVENT",
    ...r,
    endAt: r.endAt!,
    absent: true,
    detail: eventDetail(a.what, a.place, a.timeStart, a.timeEnd),
    location: a.place.trim().toUpperCase(),
  };
}
