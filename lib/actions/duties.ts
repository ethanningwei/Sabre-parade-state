"use server";

import { z } from "zod";
import { actionViewer, assertCanEditCamp, assertCanEditDuty } from "@/lib/authz";
import { endDutyCore, saveDutyCore } from "@/lib/core/duties";
import { db } from "@/lib/db";
import { DUTY_TYPES } from "@/lib/parade";
import { run, zDate, zTime } from "./shared";

const dutyInput = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(DUTY_TYPES),
  rank: z.string().trim().max(20).default(""),
  name: z.string().trim().max(100).default(""),
  /** someone on this coy's roster; required for SOL */
  personId: z.string().uuid().nullable().default(null),
  /** where an Extra/RF serves; ignored for SOL (it follows the person's home team) */
  campId: z.string().uuid().nullable().default(null),
  startDate: zDate,
  startTime: zTime.default(null),
  endDate: zDate,
  endTime: zTime.default(null),
});
export type DutyInput = z.input<typeof dutyInput>;

/** Create or edit an Extra/RF/SOL. The rules are in lib/core/duties.ts. */
export async function saveDuty(raw: DutyInput) {
  return run(async () => {
    const viewer = await actionViewer();
    const input = dutyInput.parse(raw);
    const saved = await db.transaction((tx) =>
      saveDutyCore(tx, viewer.id, input, {
        camp: (campId) => assertCanEditCamp(viewer, campId),
        duty: (dutyId) => assertCanEditDuty(viewer, dutyId),
      }),
    );
    return saved.id;
  });
}

/** Finished serving: removed from the parade state (and their home absence closed), kept as history. */
export async function endDuty(dutyId: string) {
  return run(async () => {
    const viewer = await actionViewer();
    z.string().uuid().parse(dutyId);
    await assertCanEditDuty(viewer, dutyId);
    await db.transaction((tx) => endDutyCore(tx, viewer.id, dutyId));
    return undefined;
  });
}
