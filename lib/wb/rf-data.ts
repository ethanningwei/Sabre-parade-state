import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, notInArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAssignment, wbMember, wbRecord, wbRfRequest } from "@/lib/wb/db/schema";
import { costOfSending, manningOf, snapshotFor } from "@/lib/wb/domain/forecast";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { assignmentLine, BOARD_HISTORY_MS, busyOver, canDeployRf, deployRefusal, rankCandidates, type Candidate, type LiveAssignment, type RfRequestView, type WbAssignmentType } from "@/lib/wb/domain/rf";
import { clashLines } from "@/lib/wb/domain/clash";
import { DEAD_STATES } from "@/lib/wb/domain/rules";
import { roleOf } from "@/lib/wb/domain/roles";
import { dayRange, daysTouched, type Range } from "@/lib/wb/domain/timeline";
import { campsInfo, forecastInput, loadMinimums } from "@/lib/wb/forecast-data";
import type { Db } from "@/lib/wb/records";

// RF requests and Extra/RF/SOL: the reads. The rules are pure
// (lib/wb/domain/rf.ts); the writes are in lib/wb/rf.ts.

const raiser = alias(wbMember, "raiser");
const raiserPerson = alias(person, "raiser_person");
const closer = alias(wbMember, "closer");
const closerPerson = alias(person, "closer_person");

const label = (rank: string | null, name: string | null, tgName: string | null) => (name ? `${rank} ${name}` : (tgName ?? null));

async function requestRows(tx: Db, where: SQL | undefined) {
  return tx
    .select({
      r: wbRfRequest,
      campName: camp.name,
      subunitId: subunit.id,
      subunitName: subunit.name,
      raiserTg: raiser.telegramUserId,
      raiserTgName: raiser.tgName,
      rRank: raiserPerson.rank,
      rName: raiserPerson.name,
      cTgName: closer.tgName,
      cRank: closerPerson.rank,
      cName: closerPerson.name,
    })
    .from(wbRfRequest)
    .innerJoin(camp, eq(camp.id, wbRfRequest.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(raiser, eq(raiser.id, wbRfRequest.raisedBy))
    .leftJoin(raiserPerson, eq(raiserPerson.id, raiser.personId))
    .leftJoin(closer, eq(closer.id, wbRfRequest.closedBy))
    .leftJoin(closerPerson, eq(closerPerson.id, closer.personId))
    .where(where)
    .orderBy(asc(wbRfRequest.startAt), asc(wbRfRequest.createdAt));
}

/** Requests as views, each with the men sent to it (live only, in the order they went). */
async function views(where: SQL | undefined, tx: Db = db): Promise<RfRequestView[]> {
  const rows = await requestRows(tx, where);
  if (!rows.length) return [];
  const sent = await tx
    .select({ requestId: wbAssignment.rfRequestId, assignmentId: wbAssignment.id, personId: person.id, rank: person.rank, name: person.name, campId: camp.id, campName: camp.name, subunitId: camp.subunitId })
    .from(wbAssignment)
    .innerJoin(person, eq(person.id, wbAssignment.personId))
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(inArray(wbAssignment.rfRequestId, rows.map((x) => x.r.id)), eq(wbAssignment.state, "ACTIVE")))
    .orderBy(asc(wbAssignment.createdAt));
  return rows.map((x) => ({
    id: x.r.id,
    campId: x.r.campId,
    campName: x.campName,
    subunitId: x.subunitId,
    subunitName: x.subunitName,
    role: x.r.role,
    need: x.r.need,
    reason: x.r.reason,
    state: x.r.state,
    startAt: x.r.startAt,
    endAt: x.r.endAt,
    raisedById: x.r.raisedBy,
    raisedBy: label(x.rRank, x.rName, x.raiserTgName) ?? "a commander",
    raisedByTelegramId: x.raiserTg ?? null,
    closedBy: x.r.closedBy ? (label(x.cRank, x.cName, x.cTgName) ?? "a commander") : null,
    createdAt: x.r.createdAt,
    deployed: sent
      .filter((s) => s.requestId === x.r.id)
      .map((s) => ({ assignmentId: s.assignmentId, personId: s.personId, rank: s.rank, name: s.name, campId: s.campId, campName: s.campName, subunitId: s.subunitId })),
  }));
}

export async function rfView(id: string, tx: Db = db): Promise<RfRequestView | null> {
  return (await views(eq(wbRfRequest.id, id), tx))[0] ?? null;
}

/**
 * The board: what's still open and not yet over (soonest first), then what
 * was filled or closed lately. A request whose shift has been stood is
 * history, and a board full of history stops being read.
 */
export async function board(now: Date = new Date()): Promise<{ open: RfRequestView[]; settled: RfRequestView[] }> {
  const recent = new Date(now.getTime() - BOARD_HISTORY_MS);
  const all = await views(gt(wbRfRequest.endAt, recent));
  return {
    open: all.filter((r) => r.state === "OPEN" && r.endAt!.getTime() > now.getTime()),
    settled: all.filter((r) => r.state !== "OPEN").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

/** Open requests still to come or under way: Home's badge and the evening digest. */
export async function openRequests(now: Date = new Date()): Promise<RfRequestView[]> {
  return views(and(eq(wbRfRequest.state, "OPEN"), gt(wbRfRequest.endAt, now)));
}

// ------------------------------------------------------------------ assignments

const home = alias(camp, "home");

/** Live Extra/RF/SOL overlapping a range, optionally for some people only, with where they stand. */
export async function liveAssignments(range: Range, personIds?: readonly string[], tx: Db = db): Promise<LiveAssignment[]> {
  if (personIds && !personIds.length) return [];
  return tx
    .select({ id: wbAssignment.id, personId: wbAssignment.personId, type: wbAssignment.type, campId: wbAssignment.campId, campName: camp.name, startAt: wbAssignment.startAt, endAt: wbAssignment.endAt })
    .from(wbAssignment)
    .innerJoin(camp, eq(camp.id, wbAssignment.campId))
    .where(
      and(
        eq(wbAssignment.state, "ACTIVE"),
        lt(wbAssignment.startAt, range.endAt ?? new Date(8.64e15)),
        gt(wbAssignment.endAt, range.startAt),
        personIds ? inArray(wbAssignment.personId, [...personIds]) : undefined,
      ),
    );
}

export interface AssignmentView extends Range {
  id: string;
  type: WbAssignmentType;
  personId: string;
  rank: string;
  name: string;
  /** his home camp */
  homeCampId: string;
  homeCampName: string;
  subunitId: string;
  subunitName: string;
  /** where he stands */
  campId: string;
  campName: string;
  rfRequestId: string | null;
  note: string;
  /** "RF @ SLR 14/10–15/10" */
  line: string;
}

async function assignmentViews(where: SQL, tx: Db = db): Promise<AssignmentView[]> {
  const rows = await tx
    .select({
      a: wbAssignment,
      rank: person.rank,
      name: person.name,
      homeCampId: home.id,
      homeCampName: home.name,
      subunitId: subunit.id,
      subunitName: subunit.name,
      campName: camp.name,
    })
    .from(wbAssignment)
    .innerJoin(person, eq(person.id, wbAssignment.personId))
    .innerJoin(home, eq(home.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, home.subunitId))
    .innerJoin(camp, eq(camp.id, wbAssignment.campId))
    .where(where)
    .orderBy(asc(wbAssignment.startAt), asc(subunit.sortOrder), asc(home.sortOrder), asc(person.sortOrder));
  return rows.map((x) => ({
    id: x.a.id,
    type: x.a.type,
    personId: x.a.personId,
    rank: x.rank,
    name: x.name,
    homeCampId: x.homeCampId,
    homeCampName: x.homeCampName,
    subunitId: x.subunitId,
    subunitName: x.subunitName,
    campId: x.a.campId,
    campName: x.campName,
    startAt: x.a.startAt,
    endAt: x.a.endAt,
    rfRequestId: x.a.rfRequestId,
    note: x.a.note,
    line: assignmentLine({ type: x.a.type, campName: x.campName, startAt: x.a.startAt, endAt: x.a.endAt }),
  }));
}

export async function assignmentView(id: string, tx: Db = db): Promise<AssignmentView | null> {
  return (await assignmentViews(eq(wbAssignment.id, id), tx))[0] ?? null;
}

/** Live Extra/RF/SOL not yet over, of the men this member may send (the Assign screen's list). */
export async function assignmentsInScope(grants: readonly GrantRow[], now: Date = new Date()): Promise<AssignmentView[]> {
  const rows = await assignmentViews(and(eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now))!);
  return rows.filter((a) => canDeployRf(grants, { subunitId: a.subunitId, campId: a.homeCampId }));
}

/** A man's own live Extra/RF/SOL, not yet over (Home). */
export async function assignmentsOf(personId: string, now: Date = new Date()): Promise<AssignmentView[]> {
  return assignmentViews(and(eq(wbAssignment.personId, personId), eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now))!);
}

/** Active roster people this member may send (Assign's picker). */
export async function peopleToSend(grants: readonly GrantRow[]) {
  const rows = await db
    .select({ personId: person.id, rank: person.rank, name: person.name, campId: camp.id, campName: camp.name, subunitId: subunit.id, subunitName: subunit.name })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(eq(person.active, true))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
  return rows.filter((p) => canDeployRf(grants, p));
}

// ------------------------------------------------------------------ the deploy screen

export interface DeployCandidate extends Candidate {
  roster: string;
}

/**
 * Everyone this member may send, best first: whether he fits the role, what
 * he's already down for (a warning), whether he can't go at all (his own
 * camp, already sent somewhere), and what losing him does to his own camp.
 */
export async function candidatesFor(r: RfRequestView, grants: readonly GrantRow[], now: Date = new Date()): Promise<DeployCandidate[]> {
  const people = await db
    .select({ personId: person.id, rank: person.rank, name: person.name, roster: person.role, campId: camp.id, campName: camp.name, subunitId: subunit.id })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(and(eq(person.active, true), eq(camp.coyId, (await db.select({ c: camp.coyId }).from(camp).where(eq(camp.id, r.campId)))[0].c)))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
  const mine = people.filter((p) => canDeployRf(grants, p));
  if (!mine.length) return [];

  const [input, minimums, camps, assignments] = await Promise.all([forecastInput(r, [r.campId], now), loadMinimums(), campsInfo(), liveAssignments(r, mine.map((p) => p.personId))]);
  const days = daysTouched(r).map((date) => ({ date, manning: new Map(manningOf(snapshotFor(input, dayRange(date))).map((m) => [m.campId, m])) }));
  const campOf = new Map(camps.map((c) => [c.id, c]));

  // what he's already down for: live absent records (pending too), then Extra/RF/SOL
  const awayRows = await db
    .select({
      personId: wbRecord.personId,
      kind: wbRecord.kind,
      state: wbRecord.state,
      absent: wbRecord.absent,
      startAt: wbRecord.startAt,
      endAt: wbRecord.endAt,
      detail: wbRecord.detail,
      location: wbRecord.location,
      maTiming: wbRecord.maTiming,
      mcCategory: wbRecord.mcCategory,
    })
    .from(wbRecord)
    .where(
      and(
        inArray(wbRecord.personId, mine.map((p) => p.personId)),
        eq(wbRecord.absent, true),
        notInArray(wbRecord.state, [...DEAD_STATES]),
        lt(wbRecord.startAt, r.endAt!),
        or(isNull(wbRecord.endAt), gt(wbRecord.endAt, r.startAt)),
      ),
    );

  const out = mine.map((p): DeployCandidate => {
    const role = roleOf(p.roster);
    const c = campOf.get(p.campId)!;
    const cost = costOfSending(c, days.map((d) => ({ date: d.date, manning: d.manning.get(p.campId)! })).filter((d) => d.manning), p.personId, role, minimums.get(p.campId) ?? null);
    const busy = busyOver(p.personId, r, assignments);
    return {
      ...p,
      role,
      away: clashLines(r, awayRows.filter((x) => x.personId === p.personId), [], busy),
      refusal: deployRefusal(r, p, assignments, now) ?? null,
      manning: cost.line,
      short: cost.short,
      free: cost.free,
    };
  });
  return rankCandidates(r.role, out);
}
