"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { sgtToInstant } from "@/lib/parade/time";
import { actionMember } from "@/lib/wb/auth";
import { WB_SHIFT_KINDS } from "@/lib/wb/domain/shifts";
import { miniApp, zDate, zTime } from "@/lib/wb/input";
import { clearShiftOverride, keepShift, logHoto, saveShift } from "@/lib/wb/shifts";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's shift actions: a camp's pattern and minimum manning, and the
// HOTO. Rules and permissions are in lib/wb/shifts.ts and lib/wb/domain.

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
    const res = await saveShift(miniApp(await actionMember()), shiftInput.parse(input));
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
    const by = miniApp(await actionMember());
    const a = hotoInput.parse(input);
    const res = await logHoto(await courier(), by, { campId: a.campId, on: a.on, at: sgtToInstant({ date: a.date, time: a.time }) });
    if (!res.ok) throw new UserError(res.error);
    return { matched: res.value.matched, alerted: !!res.value.alert };
  });
}

const keepInput = z.object({ campId: z.string().uuid(), on: z.boolean() });

/** Admin › Projection: keep a weekday camp on or off against its pattern. */
export async function keepCampShift(input: z.input<typeof keepInput>) {
  requireFeature();
  return run(async () => {
    const by = miniApp(await actionMember());
    const a = keepInput.parse(input);
    const res = await keepShift(by, a.campId, a.on);
    if (!res.ok) throw new UserError(res.error);
    return undefined;
  });
}

/** Back to the pattern. */
export async function clearCampShift(overrideId: string) {
  requireFeature();
  return run(async () => {
    const res = await clearShiftOverride(miniApp(await actionMember()), z.string().uuid().parse(overrideId));
    if (!res.ok) throw new UserError(res.error);
    return undefined;
  });
}
