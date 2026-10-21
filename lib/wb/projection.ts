import "server-only";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { setCampShiftCore, setStatusCore } from "@/lib/core/attendance";
import type { Tx } from "@/lib/core/audit";
import { endDutyCore, saveDutyCore } from "@/lib/core/duties";
import { db } from "@/lib/db";
import { absence, camp, duty, person, subunit, user } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { isEnabled } from "@/lib/flags";
import { wbAudit } from "@/lib/wb/audit";
import { wbAudit as wbAuditTable } from "@/lib/wb/db/schema";
import { Refusal } from "@/lib/wb/core";
import { write, type Acting, type Outcome } from "@/lib/wb/write";
import { wbAssignment, wbProjection, wbRecord, wbShiftEvent, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import { hasGrant } from "@/lib/wb/domain/grants";
import { toPattern } from "@/lib/wb/forecast-data";
import {
  absenceRow,
  dutyRow,
  planProjection,
  v1TypeOf,
  type Mark,
  type Plan,
  type PlanInput,
  type PProjection,
  type Write,
} from "@/lib/wb/domain/projection";
import { formatProjection, type Who } from "@/lib/wb/domain/projection-report";
import type { WbRole } from "@/lib/wb/domain/roles";
import { STANDING_STATES, type WbRecordKind, type WbRecordState } from "@/lib/wb/domain/rules";

// The projector: the timeline into the parade state (status §3b, plan §4f).
// planNow() works out what v1 should say now (lib/wb/domain/projection.ts);
// syncProjection() writes it through v1's own cores (lib/core) as the
// "Sabre (whereabouts)" v1 user, only when FEATURE_PROJECTION is on. Off, it's
// the shadow: the same plan, reported and never written.
//
// It runs after every whereabouts write that touches the parade state
// (lib/wb/write.ts), before the web app loads a parade state
// (lib/data/current.ts, generateParadeState), and in the evening round. One transaction holds an advisory lock, so two syncs never race; each
// write runs in its own savepoint, so one refusal (v1 locking an off-shift
// team, say) doesn't hold up the rest.

/** The projector's v1 user. Inactive, so signing in with its name gets you nowhere. */
export const PROJECTOR_USER = { id: "wb-projector", name: "Sabre (whereabouts)" } as const;
const LOCK_KEY = 0x5ab4e6; // any constant: one projector at a time
/** A sync left idle this long (its function frozen) is ended by Postgres, releasing LOCK_KEY. A real sync never pauses this long. */
const IDLE_TIMEOUT_S = 10;

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
  const open = await tx.select().from(wbProjection).where(isNull(wbProjection.closedAt));
  // an open SHIFT row is a weekday camp's "what I last set it to"; HOTO rows are closed when written
  const projections = open.filter((p) => p.kind !== "SHIFT");
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
    // someone off the roster is never projected, even leave approved before he went (kept as history)
    .innerJoin(person, and(eq(person.id, wbRecord.personId), eq(person.active, true)))
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
    .innerJoin(person, and(eq(person.id, wbAssignment.personId), eq(person.active, true)))
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

  const weeklyPatterns = await tx.select().from(wbShiftPattern).where(eq(wbShiftPattern.kind, "WEEKLY"));
  const overrides = weeklyPatterns.length
    ? await tx
        .select({ campId: wbShiftOverride.campId, on: wbShiftOverride.on, fromAt: wbShiftOverride.fromAt, untilAt: wbShiftOverride.untilAt })
        .from(wbShiftOverride)
        .where(and(isNull(wbShiftOverride.clearedAt), gt(wbShiftOverride.untilAt, now)))
    : [];
  const weekly = weeklyPatterns.map((r) => {
    const row = open.find((p) => p.kind === "SHIFT" && p.campId === r.campId);
    const on = (row?.wrote as { on?: unknown } | null)?.on;
    return {
      campId: r.campId,
      pattern: toPattern(r),
      overrides: overrides.filter((o) => o.campId === r.campId),
      wrote: row && typeof on === "boolean" ? { projectionId: row.id, on } : null,
    };
  });

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
    weekly,
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

/** The projector's v1 user, created on first use; also the v1 author of the Mini App's roster changes. */
export async function ensureProjectorUser(tx: Tx) {
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
        // a new end (an MC extended) needs a new "Back"
        await tx.update(wbProjection).set({ recordId: w.recordId, wrote, updatedAt: now, backConfirmedAt: null, backConfirmedBy: null }).where(eq(wbProjection.id, w.replaces.id));
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
      if (w.projection) await tx.update(wbProjection).set({ wrote, updatedAt: now, backConfirmedAt: null, backConfirmedBy: null }).where(eq(wbProjection.id, w.projection.id));
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
      if (w.weekly) {
        await weeklyWrote(tx, w.campId, w.onShift, w.weekly.projectionId, now);
        // a GC toggled a weekday camp in the web app: switched back, and the admins hear about it in the evening
        if (w.weekly.why === "undo-hand") {
          await wbAudit(tx, { memberId: null, via: "SYSTEM", action: "revert-shift", entity: "camp", entityId: w.campId, before: { onShift: !w.onShift }, after: { onShift: w.onShift } });
        }
      }
      return;
    }
  }
}

async function markShifts(tx: Tx, events: string[], campId: string | null, now: Date) {
  await tx.insert(wbProjection).values(events.map((shiftEventId) => ({ kind: "SHIFT" as const, shiftEventId, campId, wroteAt: now, updatedAt: now, closedAt: now, close: "DONE" as const })));
}

/** Remember what a weekday camp was set to (one open SHIFT row per camp), so a GC's toggle can be told from a switch-over. */
async function weeklyWrote(tx: Tx, campId: string, on: boolean, projectionId: string | null, now: Date) {
  if (projectionId) await tx.update(wbProjection).set({ wrote: { on }, updatedAt: now }).where(eq(wbProjection.id, projectionId));
  else await tx.insert(wbProjection).values({ kind: "SHIFT", campId, wrote: { on }, wroteAt: now, updatedAt: now });
}

async function applyMark(tx: Tx, m: Mark, now: Date) {
  if (m.op === "by-hand") await closeProjection(tx, m.projection.id, "BY_HAND", now);
  else if (m.op === "weekly-seen") await weeklyWrote(tx, m.campId, m.on, m.projectionId, now);
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
    // A serverless function can be frozen mid-sync (a page whose response has
    // already gone), leaving this transaction open and the lock held, so every
    // later sync would be "busy" for good. Postgres never times an idle
    // transaction out by default: this one ends itself, lock and all.
    await tx.execute(sql.raw(`set local idle_in_transaction_session_timeout = '${IDLE_TIMEOUT_S}s'`));
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

// ------------------------------------------------------------------ reporting

/** Rank, name and camp of everyone on the roster, and camp names in roster order, for the report. */
async function reportNames(): Promise<{ people: Map<string, Who>; camps: Map<string, string> }> {
  const [people, camps] = await Promise.all([
    db.select({ id: person.id, rank: person.rank, name: person.name, campId: person.campId }).from(person).where(eq(person.active, true)),
    db.select({ id: camp.id, name: camp.name }).from(camp).innerJoin(subunit, eq(subunit.id, camp.subunitId)).orderBy(subunit.sortOrder, camp.sortOrder),
  ]);
  return { people: new Map(people.map((p) => [p.id, p])), camps: new Map(camps.map((c) => [c.id, c.name])) };
}

/** Weekday camps the projector switched back after a GC toggled them in the web app, since `since`. */
export async function revertedSince(since: Date): Promise<{ campId: string; on: boolean; at: Date }[]> {
  const rows = await db
    .select({ campId: wbAuditTable.entityId, after: wbAuditTable.after, at: wbAuditTable.at })
    .from(wbAuditTable)
    .where(and(eq(wbAuditTable.action, "revert-shift"), gt(wbAuditTable.at, since)))
    .orderBy(wbAuditTable.at);
  return rows.map((r) => ({ campId: r.campId ?? "", on: !!(r.after as { onShift?: boolean } | null)?.onShift, at: r.at }));
}

/** A sync's result in words: the admin's "🔍 Shadow diff" or "🔁 Projection", with the weekday camps switched back since `since`. */
export async function projectionReport(res: Pick<SyncResult, "plan" | "live" | "applied" | "failed">, since?: Date): Promise<string> {
  const reverted = since ? await revertedSince(since) : [];
  return formatProjection({ ...res, mode: res.live ? "applied" : "shadow", reverted, ...(await reportNames()) });
}

/** The report for now without writing anything (`wb:setup -- diff`, Admin › Projection). */
export async function diffNow(now: Date = new Date()): Promise<string> {
  const plan = await planNow(now);
  const live = isEnabled("WHEREABOUTS") && isEnabled("PROJECTION");
  return formatProjection({ plan, mode: live ? "pending" : "shadow", ...(await reportNames()) });
}

// ------------------------------------------------------------------ "Back?"

/** Who may confirm a man is back: his camp's GC, his platoon's PC or PS, or OC, 2IC or CSM. */
export const BACK_ROLES: readonly WbRole[] = ["GC", "PC", "PS", "OC", "2IC", "CSM"];

export interface DueBack {
  projectionId: string;
  personId: string;
  rank: string;
  name: string;
  campId: string;
  campName: string;
  subunitId: string;
  /** "MC", "RF @ BDK", … */
  what: string;
  endAt: Date;
}

/**
 * Projected absences and duties that have ended, or end before `until`, with
 * no "Back" yet: the evening round asks about them the night before, so the
 * projector can close each the moment it ends (a page load syncs).
 */
export async function dueBack(until: Date): Promise<DueBack[]> {
  const who = { rank: person.rank, name: person.name, campId: person.campId, campName: camp.name, subunitId: camp.subunitId };
  const absences = await db
    .select({ projectionId: wbProjection.id, personId: person.id, ...who, type: absence.type, reason: absence.otherReason, endAt: wbRecord.endAt })
    .from(wbProjection)
    .innerJoin(wbRecord, eq(wbRecord.id, wbProjection.recordId))
    .innerJoin(absence, eq(absence.id, wbProjection.absenceId))
    .innerJoin(person, eq(person.id, wbProjection.personId))
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(
      and(
        eq(wbProjection.kind, "ABSENCE"),
        isNull(wbProjection.closedAt),
        isNull(wbProjection.backConfirmedAt),
        inArray(wbRecord.state, [...STANDING_STATES]),
        lte(wbRecord.endAt, until),
      ),
    );
  const serving = alias(camp, "serving");
  const duties = await db
    .select({ projectionId: wbProjection.id, personId: person.id, ...who, type: wbAssignment.type, at: serving.name, endAt: wbAssignment.endAt })
    .from(wbProjection)
    .innerJoin(wbAssignment, eq(wbAssignment.id, wbProjection.assignmentId))
    .innerJoin(serving, eq(serving.id, wbAssignment.campId))
    .innerJoin(person, eq(person.id, wbProjection.personId))
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(
      and(
        eq(wbProjection.kind, "DUTY"),
        isNull(wbProjection.closedAt),
        isNull(wbProjection.backConfirmedAt),
        eq(wbAssignment.state, "ACTIVE"),
        lte(wbAssignment.endAt, until),
      ),
    );
  return [
    ...absences.map(({ type, reason, endAt, ...r }) => ({ ...r, what: type === "OTHERS" ? reason : type, endAt: endAt! })),
    ...duties.map(({ type, at, ...r }) => ({ ...r, what: `${type} @ ${at}` })),
  ].sort((a, b) => a.endAt.getTime() - b.endAt.getTime());
}

/** "✅ Back" from the evening message: noted now, and the parade state marks him present once it has ended. */
export async function confirmBack(by: Acting, projectionId: string): Promise<Outcome<{ label: string; closed: boolean }>> {
  const res = await write(null, by, {
    parade: true,
    async change({ tx, audit }) {
      const [row] = await tx
        .select({ p: wbProjection, rank: person.rank, name: person.name, campId: camp.id, subunitId: camp.subunitId })
        .from(wbProjection)
        .innerJoin(person, eq(person.id, wbProjection.personId))
        .innerJoin(camp, eq(camp.id, person.campId))
        .where(eq(wbProjection.id, projectionId))
        .for("update", { of: wbProjection });
      if (!row) throw new Refusal("That's no longer on the parade state.");
      const label = `${row.rank} ${row.name}`;
      if (!hasGrant(by.actor.grants, BACK_ROLES, { subunitId: row.subunitId, campId: row.campId })) throw new Refusal(`Only ${label}'s GC, PC or PS can say he's back.`);
      if (row.p.closedAt) return label;
      const now = new Date();
      await tx.update(wbProjection).set({ backConfirmedAt: now, backConfirmedBy: by.actor.id, updatedAt: now }).where(eq(wbProjection.id, projectionId));
      await audit({ action: "confirm-back", entity: "wb_projection", entityId: projectionId });
      return label;
    },
  });
  if (!res.ok) return res;
  // the write's sync has run: closed by now if it has already ended
  const [after] = await db.select({ closedAt: wbProjection.closedAt }).from(wbProjection).where(eq(wbProjection.id, projectionId));
  return { ok: true, value: { label: res.value, closed: !!after?.closedAt } };
}

// ------------------------------------------------------------------ the Mini App

/** Whether a record is on the parade state, and if not, why. */
export type ParadeStatus = { on: true; note?: string } | { on: false; why: string };

/**
 * For the record page and today's Day view, while projection is on (an empty
 * map while it's off: nothing to say). Syncs first, so what's left in the
 * plan is what really isn't there.
 */
export async function paradeStatuses(
  records: readonly { id: string; personId: string; kind: WbRecordKind; state: WbRecordState; absent: boolean; startAt: Date; endAt: Date | null }[],
  now: Date = new Date(),
): Promise<Map<string, ParadeStatus>> {
  const out = new Map<string, ParadeStatus>();
  if (!(isEnabled("WHEREABOUTS") && isEnabled("PROJECTION")) || !records.length) return out;
  await syncQuietly();
  const ids = records.map((r) => r.id);
  const [owned, plan] = await Promise.all([
    db
      .select({ recordId: wbProjection.recordId, backConfirmedAt: wbProjection.backConfirmedAt })
      .from(wbProjection)
      .where(and(isNull(wbProjection.closedAt), inArray(wbProjection.recordId, ids))),
    planNow(now),
  ]);
  const ownedBy = new Map(owned.map((o) => [o.recordId!, o]));
  const noteOf = new Map(plan.notes.flatMap((n) => ("recordId" in n && n.recordId ? [[n.recordId, n] as const] : [])));
  for (const r of records) {
    if (!STANDING_STATES.includes(r.state) || !v1TypeOf(r)) continue;
    const mine = ownedBy.get(r.id);
    if (mine) {
      out.set(r.id, mine.backConfirmedAt ? { on: true, note: "Back confirmed: marked present when it ends" } : { on: true });
      continue;
    }
    const n = noteOf.get(r.id);
    if (n?.op === "agrees") out.set(r.id, { on: true, note: "as the GC typed it" });
    else if (n?.op === "conflict") out.set(r.id, { on: false, why: `the GC has him as ${n.has}` });
    else if (n?.op === "waiting") out.set(r.id, { on: false, why: n.reason });
    else if (n?.op === "closed-by-hand") out.set(r.id, { on: false, why: "a GC took it off by hand" });
    else if (r.startAt.getTime() > now.getTime()) out.set(r.id, { on: false, why: "goes on when it starts" });
    else if (r.endAt === null || r.endAt.getTime() > now.getTime()) out.set(r.id, { on: false, why: "his other record shows instead" });
  }
  return out;
}

/** paradeStatuses by record id (the Day view has ids, not rows). */
export async function paradeStatusesOf(recordIds: readonly string[], now: Date = new Date()): Promise<Map<string, ParadeStatus>> {
  if (!(isEnabled("WHEREABOUTS") && isEnabled("PROJECTION")) || !recordIds.length) return new Map();
  const rows = await db
    .select({ id: wbRecord.id, personId: wbRecord.personId, kind: wbRecord.kind, state: wbRecord.state, absent: wbRecord.absent, startAt: wbRecord.startAt, endAt: wbRecord.endAt })
    .from(wbRecord)
    .where(inArray(wbRecord.id, [...recordIds]));
  return paradeStatuses(rows, now);
}

/** How many v1 absences and duties the projector owns now (Admin › Projection). */
export async function projectedCounts(): Promise<{ absences: number; duties: number }> {
  const rows = await db
    .select({ kind: wbProjection.kind, n: sql<number>`count(*)::int` })
    .from(wbProjection)
    .where(isNull(wbProjection.closedAt))
    .groupBy(wbProjection.kind);
  const n = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0;
  return { absences: n("ABSENCE"), duties: n("DUTY") };
}
