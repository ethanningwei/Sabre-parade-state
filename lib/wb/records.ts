import "server-only";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { camp, duty, person, subunit } from "@/lib/db/schema";
import { clashLines } from "@/lib/wb/domain/clash";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { outcomeOrder } from "@/lib/wb/domain/describe";
import type { WbRole } from "@/lib/wb/domain/roles";
import { canDecide, canDecideRequest, canProxy, DEAD_STATES, STANDING_STATES } from "@/lib/wb/domain/rules";
import type { Range } from "@/lib/wb/domain/timeline";
import { wbAssignment, wbGrant, wbMember, wbRecord } from "@/lib/wb/db/schema";

// Read models for the timeline: one record with who it's about, a person's
// history, pending requests in a commander's scope, the clash check.

export type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const decider = alias(wbMember, "decider");
const deciderPerson = alias(person, "decider_person");
const owner = alias(wbMember, "owner");

// The diagnosis and the photo's file_id are left out of every view: a view
// reaches pages, cards and DMs. They're read only through lib/wb/medical.ts,
// which checks who's asking and audits the read.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { diagnosis: _diagnosis, evidenceFileId: _evidence, ...openColumns } = getTableColumns(wbRecord);

const viewColumns = {
  r: openColumns,
  rank: person.rank,
  name: person.name,
  campId: camp.id,
  campName: camp.name,
  subunitId: subunit.id,
  subunitName: subunit.name,
  dRank: deciderPerson.rank,
  dName: deciderPerson.name,
  dTgName: decider.tgName,
  ownerId: owner.id,
  ownerTelegramId: owner.telegramUserId,
  ownerLeaveLeft: owner.leaveLeft,
  // whose request it is decides who may approve it (rules.ts canDecideRequest)
  ownerRoles: sql<WbRole[]>`coalesce((select array_agg(distinct ${wbGrant.role}::text) from ${wbGrant} where ${wbGrant.memberId} = ${owner.id}), '{}')`,
};

export type RecordRow = Omit<typeof wbRecord.$inferSelect, "diagnosis" | "evidenceFileId">;

export interface RecordView extends RecordRow {
  rank: string;
  name: string;
  campId: string;
  campName: string;
  subunitId: string;
  subunitName: string;
  /** "2SG TAN": who decided, from the roster if they're on it */
  deciderLabel: string | null;
  /** the trooper's own member account, if they have one (proxy entries may not) */
  ownerMemberId: string | null;
  ownerTelegramId: number | null;
  ownerLeaveLeft: number | null;
  /** the roles the trooper's account holds (any scope): a PS's or PC's request goes up a level */
  ownerRoles: WbRole[];
}

function views(tx: Db, where: SQL | undefined) {
  return tx
    .select(viewColumns)
    .from(wbRecord)
    .innerJoin(person, eq(person.id, wbRecord.personId))
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(decider, eq(decider.id, wbRecord.decidedBy))
    .leftJoin(deciderPerson, eq(deciderPerson.id, decider.personId))
    .leftJoin(owner, and(eq(owner.personId, wbRecord.personId), eq(owner.active, true)))
    .where(where);
}

type ViewRow = Awaited<ReturnType<typeof views>>[number];

const toView = (v: ViewRow): RecordView => ({
  ...v.r,
  rank: v.rank,
  name: v.name,
  campId: v.campId,
  campName: v.campName,
  subunitId: v.subunitId,
  subunitName: v.subunitName,
  deciderLabel: v.dName ? `${v.dRank} ${v.dName}` : (v.dTgName ?? null),
  ownerMemberId: v.ownerId,
  ownerTelegramId: v.ownerTelegramId,
  ownerLeaveLeft: v.ownerLeaveLeft,
  ownerRoles: v.ownerRoles ?? [],
});

export async function recordView(id: string, tx: Db = db): Promise<RecordView | null> {
  const [v] = await views(tx, eq(wbRecord.id, id));
  return v ? toView(v) : null;
}

/** A person's records, newest first. The limit is high so a years-old permanent status still makes the current view. */
export async function recordsOfPerson(personId: string, limit = 500): Promise<RecordView[]> {
  const rows = await views(db, eq(wbRecord.personId, personId)).orderBy(desc(wbRecord.startAt), desc(wbRecord.createdAt)).limit(limit);
  return rows.map(toView);
}

/** Records matching a condition, as views (the evening round's queries). */
export async function findViews(where: SQL, tx: Db = db): Promise<RecordView[]> {
  return (await views(tx, where).orderBy(asc(wbRecord.startAt))).map(toView);
}

/** Several records by id (any order). */
export async function recordViews(ids: readonly string[], tx: Db = db): Promise<RecordView[]> {
  if (!ids.length) return [];
  return (await views(tx, inArray(wbRecord.id, [...ids]))).map(toView);
}

/**
 * Every row of one outcome: an MC and the statuses on the same paper. They're
 * saved in one statement with one created_at, which is what ties them.
 */
export async function outcomeBatch(r: RecordView, tx: Db = db): Promise<RecordView[]> {
  const ids = await tx
    .select({ id: wbRecord.id })
    .from(wbRecord)
    .where(and(eq(wbRecord.personId, r.personId), eq(wbRecord.createdAt, r.createdAt), inArray(wbRecord.kind, ["MC", "HL", "STATUS"])));
  return outcomeOrder(await recordViews(ids.map((x) => x.id), tx));
}

/** The direct children of these records (outcomes of a visit, statuses under a standalone MC), oldest first. */
export async function childrenOf(parentIds: readonly string[], tx: Db = db): Promise<RecordView[]> {
  if (!parentIds.length) return [];
  const rows = await views(tx, inArray(wbRecord.parentId, [...parentIds])).orderBy(asc(wbRecord.createdAt), asc(wbRecord.startAt));
  return rows.map(toView);
}

/** Pending requests this member may decide, oldest first: never their own (unless ADMIN), and a PS's or PC's only from above. */
export async function pendingFor(viewer: { personId: string | null; grants: readonly GrantRow[] }): Promise<RecordView[]> {
  const rows = await views(db, eq(wbRecord.state, "PENDING")).orderBy(asc(wbRecord.createdAt));
  return rows.map(toView).filter((r) => canDecideRequest(viewer, r));
}

/** MCs still owed on ONENS that this member decides for, oldest first. */
export async function onensOwedFor(grants: readonly GrantRow[]): Promise<RecordView[]> {
  const rows = await views(db, and(eq(wbRecord.onens, "OWED"), eq(wbRecord.state, "RECORDED"))).orderBy(asc(wbRecord.startAt));
  return rows.map(toView).filter((r) => canDecide(grants, r));
}

/** What's in the way of a new range: live absent records, open v1 duties and live Extra/RF/SOL. */
export async function clashFor(personId: string, range: Range, tx: Db = db): Promise<string[]> {
  const overlap = and(
    lt(wbRecord.startAt, range.endAt ?? new Date(8.64e15)),
    or(isNull(wbRecord.endAt), gt(wbRecord.endAt, range.startAt)),
  );
  const records = await tx
    .select()
    .from(wbRecord)
    .where(and(eq(wbRecord.personId, personId), eq(wbRecord.absent, true), overlap));
  const duties = await tx
    .select({
      type: duty.type,
      campName: camp.name,
      startDate: duty.startDate,
      startTime: duty.startTime,
      endDate: duty.endDate,
      endTime: duty.endTime,
    })
    .from(duty)
    .innerJoin(camp, eq(camp.id, duty.campId))
    .where(and(eq(duty.personId, personId), isNull(duty.closedAt)));
  const assignments = await tx
    .select({ type: wbAssignment.type, campName: camp.name, startAt: wbAssignment.startAt, endAt: wbAssignment.endAt })
    .from(wbAssignment)
    .innerJoin(camp, eq(camp.id, wbAssignment.campId))
    .where(and(eq(wbAssignment.personId, personId), eq(wbAssignment.state, "ACTIVE"), lt(wbAssignment.startAt, range.endAt ?? new Date(8.64e15)), gt(wbAssignment.endAt, range.startAt)));
  return clashLines(range, records, duties, assignments);
}

/** The last MA, for "Same as last time?". */
export async function lastMa(personId: string) {
  const [r] = await db
    .select({ maTiming: wbRecord.maTiming, location: wbRecord.location })
    .from(wbRecord)
    .where(and(eq(wbRecord.personId, personId), eq(wbRecord.kind, "MA"), inArray(wbRecord.state, [...STANDING_STATES])))
    .orderBy(desc(wbRecord.createdAt))
    .limit(1);
  return r?.maTiming ? { maTiming: r.maTiming, location: r.location } : null;
}

/**
 * Home's "Now" and "Next": the absent record live now (approved or recorded),
 * and the next one to start (pending included, so they can see it's waiting).
 */
export async function nowAndNext(personId: string, now: Date = new Date()) {
  const rows = await views(
    db,
    and(
      eq(wbRecord.personId, personId),
      eq(wbRecord.absent, true),
      or(isNull(wbRecord.endAt), gt(wbRecord.endAt, now)),
    ),
  ).orderBy(asc(wbRecord.startAt));
  const live = rows.map(toView).filter((r) => !DEAD_STATES.includes(r.state));
  const current = live.find((r) => r.startAt <= now && STANDING_STATES.includes(r.state)) ?? null;
  const next = live.find((r) => r.startAt > now) ?? null;
  return { current, next };
}

export interface ScopedPerson {
  personId: string;
  rank: string;
  name: string;
  campId: string;
  campName: string;
  subunitId: string;
  subunitName: string;
}

/** Active roster people a member may act for: "decide" (history, void) or "proxy" (add events). */
export async function peopleInScope(grants: readonly GrantRow[], purpose: "decide" | "proxy"): Promise<ScopedPerson[]> {
  const rows = await db
    .select({
      personId: person.id,
      rank: person.rank,
      name: person.name,
      campId: camp.id,
      campName: camp.name,
      subunitId: subunit.id,
      subunitName: subunit.name,
    })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(eq(person.active, true))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
  const allowed = purpose === "decide" ? canDecide : canProxy;
  return rows.filter((p) => allowed(grants, p));
}

/** Where a roster person stands, for scope checks. */
export async function personWhere(personId: string, tx: Db = db): Promise<ScopedPerson | null> {
  const [p] = await tx
    .select({
      personId: person.id,
      rank: person.rank,
      name: person.name,
      campId: camp.id,
      campName: camp.name,
      subunitId: subunit.id,
      subunitName: subunit.name,
      active: person.active,
    })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(eq(person.id, personId));
  return p && p.active ? p : null;
}

/** "2SG TAN" for a member: their roster name, else their Telegram name. */
export async function memberLabel(memberId: string, tx: Db = db): Promise<string> {
  const [m] = await tx
    .select({ rank: person.rank, name: person.name, tgName: wbMember.tgName, selfName: wbMember.selfName, selfRank: wbMember.selfRank })
    .from(wbMember)
    .leftJoin(person, eq(person.id, wbMember.personId))
    .where(eq(wbMember.id, memberId));
  if (!m) return "a commander";
  if (m.name) return `${m.rank} ${m.name}`;
  return [m.selfRank, m.selfName].filter(Boolean).join(" ") || m.tgName;
}
