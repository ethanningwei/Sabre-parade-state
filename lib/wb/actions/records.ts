"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember, type Member } from "@/lib/wb/auth";
import type { Delivery } from "@/lib/wb/core";
import { decide, notRight, sayWhy, submit, undo, voidRecord, withdraw, type Result } from "@/lib/wb/decide";
import { NOT_ON_ROSTER } from "@/lib/wb/domain/rules";
import { eventFrom, eventInput, leaveFrom, leaveInput, maFrom, maInput, miniApp, offFrom, rangeFrom, rangeInput, sickFrom, sickInput, zId, type OwnRecord } from "@/lib/wb/input";
import { clashFor, personWhere } from "@/lib/wb/records";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's timeline actions: apply, report, add for others, and the
// commander's decisions. Forms are checked in lib/wb/input, every rule lives
// in lib/wb/domain or lib/wb/decide; this file finds who's asking.

const PROXY_MAX = 40;

/** A member who is on the roster: only they can put things on their own timeline. */
async function self(): Promise<{ member: Member; personId: string; subunitName: string }> {
  const member = await actionMember();
  const where = member.personId ? await personWhere(member.personId) : null;
  if (!where) throw new UserError(NOT_ON_ROSTER);
  return { member, personId: where.personId, subunitName: where.subunitName };
}

export interface Submitted {
  recordId: string;
  /** where the card went: "sent", "no-chat" (the platoon hasn't linked one), or "failed" */
  delivery: Delivery | null;
  subunitName: string;
  /** saved approved: OC, 2IC and CSM need no approval */
  approved: boolean;
}

async function submitOwn(me: Awaited<ReturnType<typeof self>>, rec: OwnRecord): Promise<Submitted> {
  const res = await submit(await courier(), miniApp(me.member), [{ ...rec, personId: me.personId, memberId: me.member.id, createdVia: "SELF" }]);
  if (!res.ok) throw new UserError(res.error);
  const [record] = res.value.records;
  return { recordId: record.id, delivery: res.value.delivery, subunitName: me.subunitName, approved: record.state === "APPROVED" };
}

// ------------------------------------------------------------------ clash

/** What's already on those days. The form shows it with Carry on / Change dates; it never refuses. */
export async function checkClash(input: z.input<typeof rangeInput>) {
  requireFeature();
  return run(async () => {
    const me = await self();
    return clashFor(me.personId, rangeFrom(rangeInput.parse(input)));
  });
}

// ------------------------------------------------------------------ apply

/** AL or OL: dates, the days it costs (checked against the balance), where, and why. */
export async function applyLeave(input: z.input<typeof leaveInput>) {
  requireFeature();
  return run(async () => {
    const me = await self();
    return submitOwn(me, leaveFrom(input, me.member.leaveLeft ?? 0));
  });
}

/** Off: just the dates. */
export async function applyOff(input: z.input<typeof rangeInput>) {
  requireFeature();
  return run(async () => submitOwn(await self(), offFrom(input)));
}

/** An MA: the day, the time, the place. Recorded, no approval; absent for the day. */
export async function reportMa(input: z.input<typeof maInput>) {
  requireFeature();
  return run(async () => submitOwn(await self(), maFrom(input)));
}

/** Report sick: in camp (RSI) or outside (RSO). Waits for his PC or PS like leave. */
export async function reportSick(input: z.input<typeof sickInput>) {
  requireFeature();
  return run(async () => submitOwn(await self(), sickFrom(input)));
}

/** A course, brief, IPPT or anything else. Recorded, no approval. */
export async function reportEvent(input: z.input<typeof eventInput>) {
  requireFeature();
  return run(async () => submitOwn(await self(), eventFrom(input)));
}

// ------------------------------------------------------------------ report for your men (2026-10-24)

export interface Reported extends Submitted {
  /** "PTE TAN", who it's for */
  who: string;
}

/** A report sick or MA for one of his men: one PROXY row, checked by the core (reach, kind, no duplicate). */
async function submitFor(personId: string, rec: OwnRecord): Promise<Reported> {
  const member = await actionMember();
  const p = await personWhere(personId);
  if (!p) throw new UserError("He's left the roster.");
  const res = await submit(await courier(), miniApp(member), [{ ...rec, personId, memberId: null, createdVia: "PROXY" }]);
  if (!res.ok) throw new UserError(res.error);
  const [record] = res.value.records;
  return { recordId: record.id, delivery: res.value.delivery, subunitName: p.subunitName, approved: record.state === "APPROVED", who: `${p.rank} ${p.name}` };
}

const forInput = z.object({ personId: zId });

/** Report sick for one of his men: saved approved if the reporter could approve it, else it waits for the man's PC or PS. */
export async function reportSickFor(input: z.input<typeof sickInput> & z.input<typeof forInput>) {
  requireFeature();
  return run(async () => submitFor(forInput.parse(input).personId, sickFrom(input, undefined, true)));
}

/** An MA for one of his men: recorded, as the man's own. */
export async function reportMaFor(input: z.input<typeof maInput> & z.input<typeof forInput>) {
  requireFeature();
  return run(async () => submitFor(forInput.parse(input).personId, maFrom(input, undefined, true)));
}

const proxyInput = eventInput.extend({ personIds: z.array(zId).min(1, "Pick at least one person.").max(PROXY_MAX, `At most ${PROXY_MAX} at a time.`) });

/** A commander records one event for several men: one RECORDED row each, no clash step. */
export async function addEventFor(input: z.input<typeof proxyInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = proxyInput.parse(input);
    const rec = eventFrom(a);
    const ids = [...new Set(a.personIds)];
    const res = await submit(
      await courier(),
      miniApp(member),
      ids.map((personId) => ({ ...rec, personId, memberId: null, createdVia: "PROXY" as const })),
    );
    if (!res.ok) throw new UserError(res.error);
    return { count: res.value.records.length };
  });
}

// ------------------------------------------------------------------ decisions

function decided(res: Result) {
  if (!res.ok) throw new UserError(res.error);
  return { state: res.value.state };
}

const decideInput = z.object({ recordId: zId, action: z.enum(["approve", "reject"]), note: z.string().max(300).optional() });

/** Approve or reject from the Mini App (Approvals, or a record opened from a card). */
export async function decideRecord(input: z.input<typeof decideInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = decideInput.parse(input);
    return decided(await decide(await courier(), miniApp(member), a.recordId, a.action, a.note));
  });
}

const idInput = z.object({ recordId: zId });

export async function undoDecision(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    return decided(await undo(await courier(), miniApp(member), idInput.parse(input).recordId));
  });
}

/** The man says a report made for him isn't right. */
export async function notRightRecord(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    return decided(await notRight(await courier(), miniApp(member), idInput.parse(input).recordId));
  });
}

/** The trooper withdraws his own pending request. */
export async function withdrawRecord(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    return decided(await withdraw(await courier(), miniApp(member), idInput.parse(input).recordId));
  });
}

const voidInput = z.object({ recordId: zId, reason: z.string().max(300) });

/** A commander voids an approved or recorded entry, with a reason. */
export async function voidEntry(input: z.input<typeof voidInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = voidInput.parse(input);
    return decided(await voidRecord(await courier(), miniApp(member), a.recordId, a.reason));
  });
}

const whyInput = z.object({ recordId: zId, note: z.string().max(300) });

/** The reason for a rejection, given after the fact in the Mini App. */
export async function giveReason(input: z.input<typeof whyInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = whyInput.parse(input);
    return decided(await sayWhy(await courier(), miniApp(member), a.recordId, a.note));
  });
}
