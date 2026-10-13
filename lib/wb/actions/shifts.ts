"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { parseHhmm, sgtToInstant } from "@/lib/parade/time";
import { actionMember, type Member } from "@/lib/wb/auth";
import type { Actor } from "@/lib/wb/core";
import { WB_SHIFT_KINDS } from "@/lib/wb/domain/shifts";
import { logHoto, saveShift } from "@/lib/wb/shifts";
import { outbound, type Outbound } from "@/lib/wb/telegram/outbound";

// The Mini App's shift actions: a camp's pattern and minimum manning, and the
// HOTO. Rules and permissions are in lib/wb/shifts.ts and lib/wb/domain.

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const zTime = z
  .string()
  .transform((t) => parseHhmm(t))
  .refine((t): t is string => t !== null, "Give the time as HHMM, e.g. 2100.");

async function tryOutbound(): Promise<Outbound | null> {
  try {
    return await outbound();
  } catch (e) {
    console.error("wb outbound:", e);
    return null;
  }
}

const actorOf = (m: Member): Actor => ({ id: m.id, personId: m.personId, grants: m.grants });

const shiftInput = z.object({
  campIds: z.array(z.string().uuid()).min(1).max(4),
  kind: z.enum(WB_SHIFT_KINDS),
  onDays: z.number().int().min(1, "At least one day on.").max(31),
  offDays: z.number().int().min(0).max(31),
  anchorCampId: z.string().uuid().nullable(),
  anchorDate: zDate.nullable(),
  hotoTime: zTime,
  weekdayMask: z.number().int().min(0).max(127),
  holidaysOff: z.boolean(),
  bothOnAllowed: z.boolean(),
  minimums: z.record(z.string(), z.string().max(20)),
});

/** Save one physical camp's pattern (both teams of a pair) and each team's minimum. */
export async function saveShiftPattern(input: z.input<typeof shiftInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const res = await saveShift(actorOf(member), shiftInput.parse(input));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

const hotoInput = z.object({
  campId: z.string().uuid(),
  on: z.boolean(),
  date: zDate,
  time: zTime,
});

/** "SFT A took over at 2100": confirms the cycle or moves it. */
export async function recordHoto(input: z.input<typeof hotoInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    const a = hotoInput.parse(input);
    const res = await logHoto(await tryOutbound(), actorOf(member), { campId: a.campId, on: a.on, at: sgtToInstant({ date: a.date, time: a.time }) });
    if (!res.ok) throw new UserError(res.error);
    return { matched: res.value.matched, alerted: !!res.value.alert };
  });
}
