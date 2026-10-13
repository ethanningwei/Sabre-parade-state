"use server";

import { z } from "zod";
import { actionViewer, assertCanEditCamp, assertCanEditPerson } from "@/lib/authz";
import { setCampShiftCore, setStatusCore } from "@/lib/core/attendance";
import { db } from "@/lib/db";
import { ABSENCE_TYPES } from "@/lib/parade";
import { run, zDate, zTime } from "./shared";

const statusInput = z.object({
  personIds: z.array(z.string().uuid()).min(1, "Pick at least one person"),
  status: z.enum(["PRESENT", ...ABSENCE_TYPES]),
  otherReason: z.string().max(200).default(""),
  startDate: zDate.default(null),
  startTime: zTime.default(null),
  endDate: zDate.default(null),
  endTime: zTime.default(null),
  maTiming: z.string().max(20).default(""),
  maLocation: z.string().max(100).default(""),
});
export type StatusInput = z.input<typeof statusInput>;

/** Set attendance for one or more people. The rules are in lib/core/attendance.ts. */
export async function setStatus(raw: StatusInput) {
  return run(async () => {
    const viewer = await actionViewer();
    const input = statusInput.parse(raw);
    for (const id of input.personIds) await assertCanEditPerson(viewer, id);
    await db.transaction((tx) => setStatusCore(tx, viewer.id, input));
    return undefined;
  });
}

export async function setCampShift(campId: string, onShift: boolean) {
  return run(async () => {
    const viewer = await actionViewer();
    z.string().uuid().parse(campId);
    await assertCanEditCamp(viewer, campId);
    await db.transaction((tx) => setCampShiftCore(tx, viewer.id, campId, onShift));
    return undefined;
  });
}
