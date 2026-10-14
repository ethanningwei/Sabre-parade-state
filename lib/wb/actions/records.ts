"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { parseHhmm } from "@/lib/parade/time";
import { actionMember, type Member } from "@/lib/wb/auth";
import type { Actor, Delivery } from "@/lib/wb/core";
import { decide, sayWhy, submit, undo, voidRecord, withdraw, type NewRecord, type Result } from "@/lib/wb/decide";
import { eventDetail, leaveDetail, overseasWhere, reasonText } from "@/lib/wb/domain/describe";
import { AL_PLACES, LEAVE_REASONS } from "@/lib/wb/domain/roles";
import { canProxy, isAbsentKind, leaveRefusal, NOT_ON_ROSTER } from "@/lib/wb/domain/rules";
import { checkRange, dayCount, dayRange, daysTouched, MAX_DAYS, todaySgt, type Range } from "@/lib/wb/domain/timeline";
import { clashFor, personWhere } from "@/lib/wb/records";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's timeline actions: apply, report, add for others, and the
// commander's decisions. Every rule lives in lib/wb/domain or lib/wb/decide;
// this file checks input and who's asking.

const PROXY_MAX = 40;

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const zTime = z
  .string()
  .transform((t) => parseHhmm(t))
  .refine((t): t is string => t !== null, "Give the time as HHMM, e.g. 2100.");
const zText = (what: string, max = 100) => z.string().trim().min(1, `Say ${what}.`).max(max);
const zId = z.string().uuid();

const rangeInput = z.object({ startDate: zDate, startTime: zTime, endDate: zDate, endTime: zTime });

const actorOf = (m: Member): Actor => ({ id: m.id, personId: m.personId, grants: m.grants });

/** A registered member who is on the roster: only they can put things on their own timeline. */
async function self(): Promise<{ member: Member; personId: string; subunitName: string }> {
  const member = await actionMember();
  if (!member.registeredAt) throw new UserError("Register first.");
  const where = member.personId ? await personWhere(member.personId) : null;
  if (!where) throw new UserError(NOT_ON_ROSTER);
  return { member, personId: where.personId, subunitName: where.subunitName };
}

function range(input: z.infer<typeof rangeInput>, maxDays?: number): Range {
  const r = checkRange(input, todaySgt());
  if (!r.ok) throw new UserError(r.error);
  if (maxDays && dayCount(r.range) > maxDays) throw new UserError(`Apply for at most ${maxDays} days at a time. Split it into two.`);
  return r.range;
}

export interface Submitted {
  recordId: string;
  /** where the card went: "sent", "no-chat" (the platoon hasn't linked one), or "failed" */
  delivery: Delivery | null;
  subunitName: string;
  /** saved approved: OC, 2IC and CSM need no approval */
  approved: boolean;
}

async function submitOwn(rec: Omit<NewRecord, "personId" | "memberId" | "createdVia">): Promise<Submitted> {
  const me = await self();
  const { records, delivery } = await submit(
    await courier(),
    actorOf(me.member),
    [{ ...rec, personId: me.personId, memberId: me.member.id, createdVia: "SELF" }],
    "MINIAPP",
  );
  return { recordId: records[0].id, delivery, subunitName: me.subunitName, approved: records[0].state === "APPROVED" };
}

// ------------------------------------------------------------------ clash

/** What's already on those days. The form shows it with Carry on / Change dates; it never refuses. */
export async function checkClash(input: z.input<typeof rangeInput>) {
  requireFeature();
  return run(async () => {
    const me = await self();
    return clashFor(me.personId, range(rangeInput.parse(input)));
  });
}

// ------------------------------------------------------------------ apply

const leaveInput = rangeInput.extend({
  kind: z.enum(["AL", "OL"]),
  days: z.array(zDate).max(MAX_DAYS),
  place: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default(""),
  reason: z.enum([...LEAVE_REASONS, "OTHER"], { message: "Say what it's for." }),
  reasonOther: z.string().trim().max(100).default(""),
});

/** AL or OL: dates, the days it costs (checked against the balance), where, and why. */
export async function applyLeave(input: z.input<typeof leaveInput>) {
  requireFeature();
  return run(async () => {
    const me = await self();
    const a = leaveInput.parse(input);
    const r = range(a, MAX_DAYS);
    const touched = new Set(daysTouched(r));
    const days = [...new Set(a.days)];
    if (days.some((d) => !touched.has(d))) throw new UserError("Those days aren't all in the range. Go back and tick them again.");
    const refusal = leaveRefusal(days.length, me.member.leaveLeft ?? 0);
    if (refusal) throw new UserError(refusal);

    let where: string;
    if (a.kind === "AL") {
      if (!(AL_PLACES as readonly string[]).includes(a.place)) throw new UserError("Annual leave is Singapore or Johor Bahru. Further is overseas leave.");
      where = a.place;
    } else {
      if (!a.city.trim() || !a.country.trim()) throw new UserError("Say which city and country.");
      where = overseasWhere(a.city, a.country);
    }
    const why = reasonText(a.reason, a.reasonOther);
    if (!why) throw new UserError("Say what it's for.");

    return submitOwn({
      kind: a.kind,
      ...r,
      endAt: r.endAt!,
      absent: true,
      leaveDays: days.length,
      detail: leaveDetail(a.kind, where),
      location: where,
      reason: why,
    });
  });
}

/** Off: just the dates. */
export async function applyOff(input: z.input<typeof rangeInput>) {
  requireFeature();
  return run(async () => {
    const r = range(rangeInput.parse(input), MAX_DAYS);
    return submitOwn({ kind: "OFF", ...r, endAt: r.endAt!, absent: true, detail: "OFF" });
  });
}

const maInput = z.object({ date: zDate, time: zTime, place: zText("where", 100) });

/** An MA: the day, the time, the place. Recorded, no approval; absent for the day. */
export async function reportMa(input: z.input<typeof maInput>) {
  requireFeature();
  return run(async () => {
    const a = maInput.parse(input);
    if (a.date < todaySgt()) throw new UserError("The appointment is in the past. Tell your PS instead.");
    const r = dayRange(a.date);
    return submitOwn({ kind: "MA", ...r, endAt: r.endAt!, absent: true, detail: "MA", maTiming: a.time, location: a.place.toUpperCase() });
  });
}

const sickInput = z.object({
  where: z.enum(["RSI", "RSO"], { message: "Say where you're reporting sick." }),
  date: zDate,
  clinic: z.string().trim().max(100).default(""),
  symptoms: zText("what's wrong", 300),
});

/**
 * Report sick (ports Sabre Bot's SICK): in camp (RSI) or outside (RSO), the
 * day, the clinic for an RSO, and his symptoms for his commander. Waits for
 * his PC or PS like leave. Neither is an absence: only an MC or HL is.
 */
export async function reportSick(input: z.input<typeof sickInput>) {
  requireFeature();
  return run(async () => {
    const a = sickInput.parse(input);
    if (a.date < todaySgt()) throw new UserError("That day is over. Tell your PS instead.");
    if (a.where === "RSO" && !a.clinic) throw new UserError("Say which clinic or hospital.");
    const r = dayRange(a.date);
    return submitOwn({
      kind: a.where,
      ...r,
      endAt: r.endAt!,
      absent: isAbsentKind(a.where),
      detail: a.where,
      location: a.where === "RSO" ? a.clinic.toUpperCase() : "",
      reason: a.symptoms,
    });
  });
}

const eventInput = z.object({
  what: zText("what it is"),
  place: zText("where it is"),
  startDate: zDate,
  endDate: zDate,
  timeStart: zTime,
  timeEnd: zTime,
});

/** The event's range and line. Over several days the hours are the daily ones. */
function eventRecord(a: z.infer<typeof eventInput>) {
  if (a.startDate === a.endDate && a.timeEnd <= a.timeStart) throw new UserError(`It has to end after it starts: you gave ${a.timeStart} to ${a.timeEnd}.`);
  const r = range({ startDate: a.startDate, startTime: a.timeStart, endDate: a.endDate, endTime: a.timeEnd });
  return {
    kind: "EVENT" as const,
    ...r,
    endAt: r.endAt!,
    absent: true,
    detail: eventDetail(a.what, a.place, a.timeStart, a.timeEnd),
    location: a.place.trim().toUpperCase(),
  };
}

/** A course, brief, IPPT or anything else. Recorded, no approval. */
export async function reportEvent(input: z.input<typeof eventInput>) {
  requireFeature();
  return run(async () => submitOwn(eventRecord(eventInput.parse(input))));
}

const proxyInput = eventInput.extend({ personIds: z.array(zId).min(1, "Pick at least one person.").max(PROXY_MAX, `At most ${PROXY_MAX} at a time.`) });

/** A commander records one event for several men: one RECORDED row each, no clash step. */
export async function addEventFor(input: z.input<typeof proxyInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    if (!member.registeredAt) throw new UserError("Register first.");
    const a = proxyInput.parse(input);
    const rec = eventRecord(a);
    const ids = [...new Set(a.personIds)];
    const people = await Promise.all(ids.map((id) => personWhere(id)));
    const out = people.find((p) => !p || !canProxy(member.grants, p));
    if (out !== undefined) throw new UserError(out ? `${out.rank} ${out.name} isn't in your scope.` : "Someone on that list has left the roster.");
    const { records } = await submit(
      await courier(),
      actorOf(member),
      ids.map((personId) => ({ ...rec, personId, memberId: null, createdVia: "PROXY" as const })),
      "MINIAPP",
    );
    return { count: records.length };
  });
}

// ------------------------------------------------------------------ decisions

async function decided(res: Result) {
  if (!res.ok) throw new UserError(res.error);
  return { state: res.record.state };
}

const decideInput = z.object({ recordId: zId, action: z.enum(["approve", "reject"]), note: z.string().max(300).optional() });

/** Approve or reject from the Mini App (Approvals, or a record opened from a card). */
export async function decideRecord(input: z.input<typeof decideInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = decideInput.parse(input);
    return decided(await decide(await courier(), actorOf(member), a.recordId, a.action, "MINIAPP", a.note));
  });
}

const idInput = z.object({ recordId: zId });

export async function undoDecision(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    return decided(await undo(await courier(), actorOf(member), idInput.parse(input).recordId, "MINIAPP"));
  });
}

/** The trooper withdraws his own pending request. */
export async function withdrawRecord(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    return decided(await withdraw(await courier(), actorOf(member), idInput.parse(input).recordId, "MINIAPP"));
  });
}

const voidInput = z.object({ recordId: zId, reason: z.string().max(300) });

/** A commander voids an approved or recorded entry, with a reason. */
export async function voidEntry(input: z.input<typeof voidInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = voidInput.parse(input);
    return decided(await voidRecord(await courier(), actorOf(member), a.recordId, a.reason, "MINIAPP"));
  });
}

const whyInput = z.object({ recordId: zId, note: z.string().max(300) });

/** The reason for a rejection, given after the fact in the Mini App. */
export async function giveReason(input: z.input<typeof whyInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = whyInput.parse(input);
    return decided(await sayWhy(await courier(), actorOf(member), a.recordId, a.note, "MINIAPP"));
  });
}
