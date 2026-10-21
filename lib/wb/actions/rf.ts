"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { MAX_ASSIGN, MAX_NEED, RF_ROLES, WB_ASSIGNMENT_TYPES } from "@/lib/wb/domain/rf";
import { dutyRangeFrom, miniApp, rangeShape, zId } from "@/lib/wb/input";
import { assign, closeRf, deploy, raiseRf, standDown } from "@/lib/wb/rf";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's RF actions: raise a request, deploy a man to it, close it,
// stand a man down, and Assign Extra/RF/SOL directly. Rules and permissions
// are in lib/wb/rf.ts and lib/wb/domain/rf.ts; this checks input.

/** An RF or Extra covers a few shifts; SOL can run for weeks. */
const MAX_DAYS = { RF: 31, EXTRA: 31, SOL: 92 } as const;

const commander = async () => miniApp(await actionMember());

// ------------------------------------------------------------------ requests

const raiseInput = z.object({
  campId: zId,
  role: z.enum(RF_ROLES),
  need: z.number().int().min(1, "Ask for at least one man.").max(MAX_NEED, `At most ${MAX_NEED} men in one request.`),
  ...rangeShape,
  reason: z.string().trim().min(3, "Say why you need them.").max(200),
});

export async function raiseRequest(input: z.input<typeof raiseInput>) {
  requireFeature();
  return run(async () => {
    const by = await commander();
    const a = raiseInput.parse(input);
    const res = await raiseRf(await courier(), by, { campId: a.campId, role: a.role, need: a.need, reason: a.reason.toUpperCase(), ...dutyRangeFrom(a, MAX_DAYS.RF) });
    if (!res.ok) throw new UserError(res.error);
    return { requestId: res.value.request.id, delivery: res.value.delivery, chats: res.value.chats };
  });
}

export async function deployMan(requestId: string, personId: string) {
  requireFeature();
  return run(async () => {
    const res = await deploy(await courier(), await commander(), zId.parse(requestId), zId.parse(personId));
    if (!res.ok) throw new UserError(res.error);
    return { state: res.value.request.state, away: res.value.away };
  });
}

export async function closeRequest(requestId: string) {
  requireFeature();
  return run(async () => {
    const res = await closeRf(await courier(), await commander(), zId.parse(requestId));
    if (!res.ok) throw new UserError(res.error);
    return { stillSent: res.value.deployed.length };
  });
}

export async function standDownMan(assignmentId: string) {
  requireFeature();
  return run(async () => {
    const res = await standDown(await courier(), await commander(), zId.parse(assignmentId));
    if (!res.ok) throw new UserError(res.error);
    return undefined;
  });
}

// ------------------------------------------------------------------ assign

const assignInput = z.object({
  type: z.enum(WB_ASSIGNMENT_TYPES),
  campId: zId.nullable(),
  personIds: z.array(zId).min(1, "Pick at least one man.").max(MAX_ASSIGN, `At most ${MAX_ASSIGN} men at a time.`),
  ...rangeShape,
  note: z.string().trim().max(200).default(""),
});

export async function assignMen(input: z.input<typeof assignInput>) {
  requireFeature();
  return run(async () => {
    const by = await commander();
    const a = assignInput.parse(input);
    const res = await assign(await courier(), by, { type: a.type, campId: a.type === "SOL" ? null : a.campId, personIds: [...new Set(a.personIds)], note: a.note, ...dutyRangeFrom(a, MAX_DAYS[a.type]) });
    if (!res.ok) throw new UserError(res.error);
    return { count: res.value.ids.length };
  });
}
