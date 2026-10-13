// The bodies of v1's setStatus and setCampShift, as plain functions on a
// transaction. The server actions (lib/actions/attendance.ts) do the sign-in,
// permission checks and input parsing and then call these; the whereabouts
// projector calls them directly as its own user. The rules live here only.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { absence, camp, person } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { DATED_ABSENCE_TYPES, type AbsenceType } from "@/lib/parade";
import { writeAudit, type Tx } from "./audit";

/** setStatus's input once parsed: trimmed strings, dates YYYY-MM-DD, times HHMM. */
export interface StatusValues {
  personIds: string[];
  status: "PRESENT" | AbsenceType;
  otherReason: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  maTiming: string;
  maLocation: string;
}

type Absence = typeof absence.$inferSelect;

/** What happened to each person's open absence. */
export interface StatusResult {
  personId: string;
  /** the open absence before, if any */
  before: Absence | null;
  /** the open absence after; null when marked present */
  after: Absence | null;
}

/**
 * Set attendance for one or more people.
 * - PRESENT closes their open absence (kept as history).
 * - Same type as the open absence -> edited in place (e.g. extending an MC).
 * - Different type -> the old one is closed and a new one opened.
 */
export async function setStatusCore(tx: Tx, actorId: string | null, input: StatusValues): Promise<StatusResult[]> {
  // an off-shift team isn't printed or counted, so its attendance is locked
  const offShift = await tx
    .selectDistinct({ name: camp.name })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(inArray(person.id, input.personIds), eq(camp.onShift, false)));
  if (offShift.length) {
    throw new UserError(`${offShift.map((c) => c.name).join(", ")} is off shift. Put it on shift to update attendance.`);
  }

  const { status } = input;
  if (status !== "PRESENT") {
    if (DATED_ABSENCE_TYPES.includes(status) && (!input.startDate || !input.endDate)) {
      throw new UserError(`${status} needs a start and end date.`);
    }
    if (status === "MA" && !input.maTiming.trim()) throw new UserError("MA needs a timing, e.g. 1300.");
    if (status === "OTHERS" && !input.otherReason.trim()) throw new UserError("Please give the reason.");
    if (input.startDate && input.endDate) {
      const start = `${input.startDate} ${input.startTime ?? "0000"}`;
      const end = `${input.endDate} ${input.endTime ?? "2359"}`;
      if (end < start) throw new UserError("The end is before the start.");
    }
  }

  const fields =
    status === "PRESENT"
      ? null
      : {
          type: status,
          otherReason: status === "OTHERS" ? input.otherReason.trim() : "",
          startDate: input.startDate,
          startTime: input.startDate ? input.startTime : null,
          endDate: status === "MA" ? null : input.endDate,
          endTime: status === "MA" || !input.endDate ? null : input.endTime,
          maTiming: status === "MA" ? input.maTiming.trim() : "",
          maLocation: status === "MA" ? input.maLocation.trim() : "",
        };

  const results: StatusResult[] = [];
  for (const personId of input.personIds) {
    const [open] = await tx
      .select()
      .from(absence)
      .where(and(eq(absence.personId, personId), isNull(absence.closedAt)));

    if (!fields) {
      if (!open) continue;
      await tx
        .update(absence)
        .set({ closedAt: new Date(), closedBy: actorId })
        .where(eq(absence.id, open.id));
      await writeAudit(tx, actorId, "mark-present", "absence", open.id, open, null);
      results.push({ personId, before: open, after: null });
    } else if (open && open.type === fields.type) {
      const [after] = await tx.update(absence).set(fields).where(eq(absence.id, open.id)).returning();
      await writeAudit(tx, actorId, "update-absence", "absence", open.id, open, after);
      results.push({ personId, before: open, after });
    } else {
      if (open) {
        await tx
          .update(absence)
          .set({ closedAt: new Date(), closedBy: actorId })
          .where(eq(absence.id, open.id));
      }
      const [created] = await tx
        .insert(absence)
        .values({ personId, createdBy: actorId, ...fields })
        .returning();
      await writeAudit(tx, actorId, "set-absence", "absence", created.id, open ?? null, created);
      results.push({ personId, before: open ?? null, after: created });
    }
  }
  return results;
}

export async function setCampShiftCore(tx: Tx, actorId: string | null, campId: string, onShift: boolean) {
  const [before] = await tx.select().from(camp).where(eq(camp.id, campId));
  const [after] = await tx.update(camp).set({ onShift }).where(eq(camp.id, campId)).returning();
  await writeAudit(tx, actorId, onShift ? "shift-on" : "shift-off", "camp", campId, { onShift: before.onShift }, { onShift });
  return { before, after };
}
