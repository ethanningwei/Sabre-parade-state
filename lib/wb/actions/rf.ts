"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { parseHhmm } from "@/lib/parade/time";
import { actionMember, type Member } from "@/lib/wb/auth";
import type { Actor } from "@/lib/wb/core";
import { MAX_ASSIGN, MAX_NEED, RF_ROLES, WB_ASSIGNMENT_TYPES } from "@/lib/wb/domain/rf";
import { checkRange, dayCount, todaySgt, type Range } from "@/lib/wb/domain/timeline";
import { assign, closeRf, deploy, raiseRf, standDown } from "@/lib/wb/rf";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's RF actions: raise a request, deploy a man to it, close it,
// stand a man down, and Assign Extra/RF/SOL directly. Rules and permissions
// are in lib/wb/rf.ts and lib/wb/domain/rf.ts; this checks input.

/** An RF or Extra covers a few shifts; SOL can run for weeks. */
const MAX_DAYS = { RF: 31, EXTRA: 31, SOL: 92 } as const;

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const zTime = z
  .string()
  .transform((t) => parseHhmm(t))
  .refine((t): t is string => t !== null, "Give the time as HHMM, e.g. 2100.");
const zId = z.string().uuid();
const rangeInput = { startDate: zDate, startTime: zTime, endDate: zDate, endTime: zTime };

const actorOf = (m: Member): Actor => ({ id: m.id, personId: m.personId, grants: m.grants });

async function commander(): Promise<Member> {
  const member = await actionMember();
  if (!member.registeredAt) throw new UserError("Register first.");
  return member;
}

function range(input: { startDate: string; startTime: string; endDate: string; endTime: string }, maxDays: number): Range & { endAt: Date } {
  const r = checkRange(input, todaySgt());
  if (!r.ok) throw new UserError(r.error);
  if (r.range.endAt!.getTime() <= Date.now()) throw new UserError("The end has already passed.");
  if (dayCount(r.range) > maxDays) throw new UserError(`At most ${maxDays} days at a time. Split it into two.`);
  return r.range as Range & { endAt: Date };
}

// ------------------------------------------------------------------ requests

const raiseInput = z.object({
  campId: zId,
  role: z.enum(RF_ROLES),
  need: z.number().int().min(1, "Ask for at least one man.").max(MAX_NEED, `At most ${MAX_NEED} men in one request.`),
  ...rangeInput,
  reason: z.string().trim().min(3, "Say why you need them.").max(200),
});

export async function raiseRequest(input: z.input<typeof raiseInput>) {
  requireFeature();
  return run(async () => {
    const member = await commander();
    const a = raiseInput.parse(input);
    const res = await raiseRf(await courier(), actorOf(member), { campId: a.campId, role: a.role, need: a.need, reason: a.reason.toUpperCase(), ...range(a, MAX_DAYS.RF) }, "MINIAPP");
    if (!res.ok) throw new UserError(res.error);
    return { requestId: res.value.request.id, delivery: res.value.delivery, chats: res.value.chats };
  });
}

export async function deployMan(requestId: string, personId: string) {
  requireFeature();
  return run(async () => {
    const member = await commander();
    const res = await deploy(await courier(), actorOf(member), zId.parse(requestId), zId.parse(personId), "MINIAPP");
    if (!res.ok) throw new UserError(res.error);
    return { state: res.value.request.state, away: res.value.away };
  });
}

export async function closeRequest(requestId: string) {
  requireFeature();
  return run(async () => {
    const member = await commander();
    const res = await closeRf(await courier(), actorOf(member), zId.parse(requestId), "MINIAPP");
    if (!res.ok) throw new UserError(res.error);
    return { stillSent: res.value.deployed.length };
  });
}

export async function standDownMan(assignmentId: string) {
  requireFeature();
  return run(async () => {
    const member = await commander();
    const res = await standDown(await courier(), actorOf(member), zId.parse(assignmentId), "MINIAPP");
    if (!res.ok) throw new UserError(res.error);
    return undefined;
  });
}

// ------------------------------------------------------------------ assign

const assignInput = z.object({
  type: z.enum(WB_ASSIGNMENT_TYPES),
  campId: zId.nullable(),
  personIds: z.array(zId).min(1, "Pick at least one man.").max(MAX_ASSIGN, `At most ${MAX_ASSIGN} men at a time.`),
  ...rangeInput,
  note: z.string().trim().max(200).default(""),
});

export async function assignMen(input: z.input<typeof assignInput>) {
  requireFeature();
  return run(async () => {
    const member = await commander();
    const a = assignInput.parse(input);
    const res = await assign(
      await courier(),
      actorOf(member),
      { type: a.type, campId: a.type === "SOL" ? null : a.campId, personIds: [...new Set(a.personIds)], note: a.note, ...range(a, MAX_DAYS[a.type]) },
      "MINIAPP",
    );
    if (!res.ok) throw new UserError(res.error);
    return { count: res.value.ids.length };
  });
}
