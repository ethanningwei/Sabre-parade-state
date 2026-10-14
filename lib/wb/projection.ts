import "server-only";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { setCampShiftCore, setStatusCore } from "@/lib/core/attendance";
import type { Tx } from "@/lib/core/audit";
import { endDutyCore, saveDutyCore } from "@/lib/core/duties";
import { db } from "@/lib/db";
import { absence, camp, duty, person, user } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { isEnabled } from "@/lib/flags";
import { wbAssignment, wbProjection, wbRecord, wbShiftEvent } from "@/lib/wb/db/schema";
import {
  absenceRow,
  dutyRow,
  planProjection,
  type Mark,
  type Plan,
  type PlanInput,
  type PProjection,
  type Write,
} from "@/lib/wb/domain/projection";
import { STANDING_STATES } from "@/lib/wb/domain/rules";

// The projector: the timeline into the parade state (status §3b, plan §4f).
// planNow() works out what v1 should say now (lib/wb/domain/projection.ts);
// syncProjection() writes it through v1's own cores (lib/core) as the
// "Sabre (whereabouts)" v1 user, only when FEATURE_PROJECTION is on. Off, it's
// the shadow: the same plan, reported and never written.
//
// It runs after every whereabouts write (inTx), before the web app loads a
// parade state (lib/data/current.ts, generateParadeState), and in the evening
// round. One transaction holds an advisory lock, so two syncs never race; each
// write runs in its own savepoint, so one refusal (v1 locking an off-shift
// team, say) doesn't hold up the rest.

/** The projector's v1 user. Inactive, so signing in with its name gets you nowhere. */
export const PROJECTOR_USER = { id: "wb-projector", name: "Sabre (whereabouts)" } as const;
const LOCK_KEY = 0x5ab4e6; // any constant: one projector at a time

export interface SyncResult {
  live: boolean;
  /** another sync held the lock, so this one did nothing */
  busy: boolean;
  plan: Plan;
  applied: number;
  failed: { write: Write; error: string }[];
}

type Reader = Pick<Tx, "select">;

/** Everything the plan needs, read in one go. */
export async function loadPlanInput(tx: Reader, now: Date): Promise<PlanInput> {
  const projections = await tx.select().from(wbProjection).where(isNull(wbProjection.closedAt));
  const ownedRecords = projections.flatMap((p) => (p.recordId ? [p.recordId] : []));
  const ownedAssignments = projections.flatMap((p) => (p.assignmentId ? [p.assignmentId] : []));

  const records = await tx
    .select({
      id: wbRecord.id,
      personId: wbRecord.personId,
      kind: wbRecord.kind,
      state: wbRecord.state,
      absent: wbRecord.absent,
      startAt: wbRecord.startAt,
      endAt: wbRecord.endAt,
      detail: wbRecord.detail,
      location: wbRecord.location,
      maTiming: wbRecord.maTiming,
    })
    .from(wbRecord)
    .where(
      or(
        and(
          eq(wbRecord.absent, true),
          inArray(wbRecord.state, [...STANDING_STATES]),
          lte(wbRecord.startAt, now),
          or(isNull(wbRecord.endAt), gt(wbRecord.endAt, now)),
        ),
        ownedRecords.length ? inArray(wbRecord.id, ownedRecords) : sql`false`,
      ),
    );
  const assignments = await tx
    .select({
      id: wbAssignment.id,
      personId: wbAssignment.personId,
      type: wbAssignment.type,
      campId: wbAssignment.campId,
      startAt: wbAssignment.startAt,
      endAt: wbAssignment.endAt,
      state: wbAssignment.state,
    })
    .from(wbAssignment)
    .where(
      or(
        and(eq(wbAssignment.state, "ACTIVE"), lte(wbAssignment.startAt, now), gt(wbAssignment.endAt, now)),
        ownedAssignments.length ? inArray(wbAssignment.id, ownedAssignments) : sql`false`,
      ),
    );
  // closed projections matter only to say "a GC closed this one: don't reopen it"
  const recordIds = records.map((r) => r.id);
  const assignmentIds = assignments.map((a) => a.id);
  const byHand =
    recordIds.length || assignmentIds.length
      ? await tx
          .select()
          .from(wbProjection)
          .where(
            and(
              eq(wbProjection.close, "BY_HAND"),
              or(
                recordIds.length ? inArray(wbProjection.recordId, recordIds) : sql`false`,
                assignmentIds.length ? inArray(wbProjection.assignmentId, assignmentIds) : sql`false`,
              ),
            ),
          )
      : [];

  const shiftEvents = await tx
    .select({ id: wbShiftEvent.id, campId: wbShiftEvent.campId, at: wbShiftEvent.at, on: wbShiftEvent.on })
    .from(wbShiftEvent)
    .leftJoin(wbProjection, eq(wbProjection.shiftEventId, wbShiftEvent.id))
    .where(and(isNull(wbProjection.id), lte(wbShiftEvent.at, now)));

  const camps = await tx.select({ id: camp.id, name: camp.name, post: camp.post, subunitId: camp.subunitId, onShift: camp.onShift }).from(camp);
  const people = await tx.select({ id: person.id, campId: person.campId }).from(person).where(eq(person.active, true));
  const absences = await tx
    .select({
      id: absence.id,
      personId: absence.personId,
      type: absence.type,
      otherReason: absence.otherReason,
      startDate: absence.startDate,
      startTime: absence.startTime,
      endDate: absence.endDate,
      endTime: absence.endTime,
      maTiming: absence.maTiming,
      maLocation: absence.maLocation,
      dutyId: absence.dutyId,
    })
    .from(absence)
    .innerJoin(person, eq(person.id, absence.personId))
    .where(and(isNull(absence.closedAt), eq(person.active, true)));
  const duties = await tx
    .select({
      id: duty.id,
      personId: duty.personId,
      type: duty.type,
      campId: duty.campId,
      startDate: duty.startDate,
      startTime: duty.startTime,
      endDate: duty.endDate,
      endTime: duty.endTime,
    })
    .from(duty)
    .where(isNull(duty.closedAt));

  const asP = (p: typeof wbProjection.$inferSelect): PProjection => ({
    id: p.id,
    kind: p.kind,
    personId: p.personId,
    recordId: p.recordId,
    assignmentId: p.assignmentId,
    absenceId: p.absenceId,
    dutyId: p.dutyId,
    closedAt: p.closedAt,
    close: p.close,
    backConfirmedAt: p.backConfirmedAt,
    wrote: p.wrote,
  });
  return {
    now,
    records,
    assignments,
    shiftEvents,
    absences,
    duties,
    camps: camps.map((c) => ({ ...c, post: c.post ?? c.name })),
    homeOf: new Map(people.map((p) => [p.id, p.campId])),
    projections: [...projections, ...byHand].map(asP),
  };
}

/** The plan for now, read-only: the shadow diff and the Mini App's "on the parade state yet?". */
export async function planNow(now: Date = new Date()): Promise<Plan> {
  return planProjection(await loadPlanInput(db, now));
}

async function ensureProjectorUser(tx: Tx) {
  await tx
    .insert(user)
    .values({ ...PROJECTOR_USER, role: "pending", active: false })
    .onConflictDoNothing();
  const [row] = await tx.select({ id: user.id }).from(user).where(eq(user.id, PROJECTOR_USER.id));
  if (!row) throw new Error(`Can't create the projector's v1 user: is someone already called "${PROJECTOR_USER.name}"?`);
}

const ME = PROJECTOR_USER.id;

async function closeProjection(tx: Tx, id: string, close: NonNullable<PProjection["close"]>, now: Date) {
  await tx.update(wbProjection).set({ closedAt: now, close, updatedAt: now }).where(eq(wbProjection.id, id));
}

async function apply(tx: Tx, w: Write, now: Date) {
  switch (w.op) {
    case "absence": {
      const [res] = await setStatusCore(tx, ME, { personIds: [w.personId], ...w.values });
      const wrote = absenceRow(w.values);
      if (w.replaces && res.after?.id === w.replaces.absenceId) {
        await tx.update(wbProjection).set({ recordId: w.recordId, wrote, updatedAt: now }).where(eq(wbProjection.id, w.replaces.id));
        return;
      }
      if (w.replaces) await closeProjection(tx, w.replaces.id, "REPLACED", now);
      await tx.insert(wbProjection).values({ kind: "ABSENCE", personId: w.personId, recordId: w.recordId, absenceId: res.after!.id, wrote, wroteAt: now, updatedAt: now });
      return;
    }
    case "close-absence": {
      await setStatusCore(tx, ME, { personIds: [w.personId], status: "PRESENT", otherReason: "", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "" });
      await closeProjection(tx, w.projection.id, w.why, now);
      return;
    }
    case "duty": {
      const saved = await saveDutyCore(tx, ME, { ...w.values, id: w.projection?.dutyId ?? undefined });
      const wrote = dutyRow(w.values);
      if (w.projection) await tx.update(wbProjection).set({ wrote, updatedAt: now }).where(eq(wbProjection.id, w.projection.id));
      else await tx.insert(wbProjection).values({ kind: "DUTY", personId: w.personId, assignmentId: w.assignmentId, dutyId: saved.id, wrote, wroteAt: now, updatedAt: now });
      return;
    }
    case "end-duty": {
      await endDutyCore(tx, ME, w.projection.dutyId!);
      await closeProjection(tx, w.projection.id, w.why, now);
      return;
    }
    case "shift": {
      await setCampShiftCore(tx, ME, w.campId, w.onShift);
      if (w.events.length) await markShifts(tx, w.events, w.campId, now);
      return;
    }
  }
}

async function markShifts(tx: Tx, events: string[], campId: string | null, now: Date) {
  await tx.insert(wbProjection).values(events.map((shiftEventId) => ({ kind: "SHIFT" as const, shiftEventId, campId, wroteAt: now, updatedAt: now, closedAt: now, close: "DONE" as const })));
}

async function applyMark(tx: Tx, m: Mark, now: Date) {
  if (m.op === "by-hand") await closeProjection(tx, m.projection.id, "BY_HAND", now);
  else await markShifts(tx, m.events, null, now);
}

/**
 * Bring the parade state in line with the timeline. Off (shadow), it only
 * returns the plan. A write v1 refuses is reported in `failed` and tried again
 * next time; anything else unexpected is reported the same way, never thrown,
 * so a caller in the web app can't be broken by the projector.
 */
export async function syncProjection(now: Date = new Date()): Promise<SyncResult> {
  const live = isEnabled("WHEREABOUTS") && isEnabled("PROJECTION");
  if (!live) return { live, busy: false, plan: await planNow(now), applied: 0, failed: [] };

  return db.transaction(async (tx) => {
    const [{ locked }] = (await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`)).rows as { locked: boolean }[];
    if (!locked) return { live, busy: true, plan: { writes: [], marks: [], notes: [] }, applied: 0, failed: [] };
    await ensureProjectorUser(tx);
    const plan = planProjection(await loadPlanInput(tx, now));
    for (const m of plan.marks) await applyMark(tx, m, now);
    let applied = 0;
    const failed: SyncResult["failed"] = [];
    for (const w of plan.writes) {
      try {
        await tx.transaction((sp) => apply(sp, w, now));
        applied++;
      } catch (e) {
        if (!(e instanceof UserError)) console.error("projection write failed", w.op, e);
        failed.push({ write: w, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { live, busy: false, plan, applied, failed };
  });
}

/** For callers that mustn't fail because of the projector: v1 page loads and whereabouts writes. */
export async function syncQuietly(): Promise<void> {
  if (!(isEnabled("WHEREABOUTS") && isEnabled("PROJECTION"))) return;
  try {
    await syncProjection();
  } catch (e) {
    console.error("projection sync failed", e);
  }
}
