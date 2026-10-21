import "server-only";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { removePersonCore, savePersonCore } from "@/lib/core/people";
import { endDutyCore } from "@/lib/core/duties";
import type { Tx } from "@/lib/core/audit";
import { db } from "@/lib/db";
import { absence, camp, duty, person, subunit } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { Refusal } from "@/lib/wb/core";
import { wbAssignment, wbGrant, wbMember, wbProjection, wbRecord } from "@/lib/wb/db/schema";
import { RANKS, rolesFor } from "@/lib/wb/domain/roles";
import { addedText, canRemoveFromRoster, inRosterScope, removalRefusal, type RemovalCounts } from "@/lib/wb/domain/roster-flow";
import { STANDING_STATES } from "@/lib/wb/domain/rules";
import { place } from "@/lib/wb/format";
import { ensureProjectorUser, PROJECTOR_USER } from "@/lib/wb/projection";
import { memberLabel, personWhere, type Db } from "@/lib/wb/records";
import { recountRequest } from "@/lib/wb/rf";
import { courier as liveCourier, type Courier } from "@/lib/wb/telegram/courier";
import { joinWrite, write, type Acting, type By, type Change } from "@/lib/wb/write";

// The roster flow between the Mini App and the parade state (status §3a).
// Removing a man takes everything whereabouts holds for him with him: his
// open v1 duties, his Extra/RF/SOL, his pending requests, his grants and his
// account. Approved entries still to come stay, as history (the projector
// never writes anything for someone off the roster). Adding a man from Roster
// creates his v1 person through v1's own core and links his account.
//
// The v1 author of what the Mini App writes into v1 is the projector's user,
// "Sabre (whereabouts)"; who really did it is in wb_audit.

/** Who is taking him off, beyond the Write's By. */
export interface Removal {
  /** in the withdrawn requests' note: "Removed from roster by <label>", or "at ORD" for the evening round */
  label: string;
  /** the v1 user for v1's audit_log and closed_by */
  v1UserId: string;
}

const REASON = "removed from roster";

/** A Write always hands over its transaction; v1's cores want it typed as one. */
const asTx = (t: Db) => t as Tx;

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ------------------------------------------------------------------ remove

/** What removing him will do, for the confirmation sheet. */
export async function removalPreview(personId: string, now: Date = new Date()): Promise<RemovalCounts> {
  const n = sql<number>`count(*)::int`;
  const [[absences], [duties], [assignments], [pending], [ahead], [member]] = await Promise.all([
    db.select({ n }).from(absence).where(and(eq(absence.personId, personId), isNull(absence.closedAt))),
    db.select({ n }).from(duty).where(and(eq(duty.personId, personId), isNull(duty.closedAt))),
    db.select({ n }).from(wbAssignment).where(and(eq(wbAssignment.personId, personId), eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now))),
    db.select({ n }).from(wbRecord).where(and(eq(wbRecord.personId, personId), eq(wbRecord.state, "PENDING"))),
    db.select({ n }).from(wbRecord).where(and(eq(wbRecord.personId, personId), inArray(wbRecord.state, [...STANDING_STATES]), gt(wbRecord.startAt, now))),
    db.select({ id: wbMember.id, active: wbMember.active }).from(wbMember).where(eq(wbMember.personId, personId)),
  ]);
  return {
    absences: absences.n,
    duties: duties.n,
    assignments: assignments.n,
    pending: pending.n,
    grants: member ? await grantLabels(member.id) : [],
    account: !!member?.active,
    ahead: ahead.n,
  };
}

async function grantLabels(memberId: string): Promise<string[]> {
  const rows = await db
    .select({ role: wbGrant.role, sub: subunit.name, camp: camp.name })
    .from(wbGrant)
    .leftJoin(subunit, eq(subunit.id, wbGrant.subunitId))
    .leftJoin(camp, eq(camp.id, wbGrant.campId))
    .where(eq(wbGrant.memberId, memberId));
  return rows.map((r) => `${r.role} · ${r.camp ?? r.sub ?? "Company"}`);
}

/** He holds an ADMIN grant and no other active account does. */
export async function lastAdmin(tx: Tx, memberId: string): Promise<boolean> {
  const [mine] = await tx.select({ id: wbGrant.id }).from(wbGrant).where(and(eq(wbGrant.memberId, memberId), eq(wbGrant.role, "ADMIN")));
  if (!mine) return false;
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(wbGrant)
    .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
    .where(and(eq(wbGrant.role, "ADMIN"), ne(wbGrant.memberId, memberId), eq(wbMember.active, true)));
  return n === 0;
}

export interface Cleanup {
  /** withdrawn records, whose cards are redrawn */
  recordIds: string[];
  /** RF requests a stood-down man was filling */
  rfIds: string[];
  counts: { duties: number; assignments: number; withdrawn: number; grants: number; account: boolean; projections: number };
}

/**
 * Everything whereabouts holds for a man leaving the roster, inside a Write
 * (after v1's removePersonCore). Throws UserError for the last admin. Sends
 * nothing: the Write redraws the cards once it commits (redrawAfter).
 */
export async function cleanupWhereabouts({ tx: t, audit: write }: Change, by: By, personId: string, removal: Removal, now: Date = new Date()): Promise<Cleanup> {
  const tx = asTx(t);
  const memberId = "actor" in by ? by.actor.id : null;
  const audit = (action: string, entity: string, entityId: string, before: unknown, after: Record<string, unknown> = {}) =>
    write({ action, entity, entityId, before, after: { ...after, reason: REASON } });

  const [member] = await tx.select().from(wbMember).where(eq(wbMember.personId, personId)).for("update");
  if (member && (await lastAdmin(tx, member.id))) throw new UserError(removalRefusal({ self: false, lastAdmin: true })!);

  // his open v1 duties, with their "RF @ X" home absences
  const duties = await tx.select({ id: duty.id }).from(duty).where(and(eq(duty.personId, personId), isNull(duty.closedAt)));
  for (const d of duties) {
    await endDutyCore(tx, removal.v1UserId, d.id);
    await audit("end-duty", "duty", d.id, null);
  }

  // his Extra/RF/SOL in Sabre, now or to come; a request he was filling opens again
  const stood = await tx
    .update(wbAssignment)
    .set({ state: "CANCELLED", cancelledBy: memberId, cancelledAt: now })
    .where(and(eq(wbAssignment.personId, personId), eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now)))
    .returning({ id: wbAssignment.id, rfRequestId: wbAssignment.rfRequestId });
  const rfIds = [...new Set(stood.flatMap((a) => (a.rfRequestId ? [a.rfRequestId] : [])))];
  for (const id of rfIds) await recountRequest(tx, id);
  for (const a of stood) await audit("stand-down", "wb_assignment", a.id, { state: "ACTIVE" }, { state: "CANCELLED", rfRequestId: a.rfRequestId });

  // his requests still waiting on a decision
  const withdrawn = await tx
    .update(wbRecord)
    .set({ state: "WITHDRAWN", decisionNote: "system" in by && by.system === "SYSTEM" ? `Removed from roster at ${removal.label}` : `Removed from roster by ${removal.label}`, updatedAt: now })
    .where(and(eq(wbRecord.personId, personId), eq(wbRecord.state, "PENDING")))
    .returning({ id: wbRecord.id });
  for (const r of withdrawn) await audit("withdraw", "wb_record", r.id, { state: "PENDING" }, { state: "WITHDRAWN" });

  // his grants and his account: a removed PS can't approve anything
  let grants = 0;
  if (member) {
    const gone = await tx.delete(wbGrant).where(eq(wbGrant.memberId, member.id)).returning();
    for (const g of gone) await audit("revoke", "wb_grant", g.id, g);
    grants = gone.length;
    if (member.active) {
      await tx.update(wbMember).set({ active: false }).where(eq(wbMember.id, member.id));
      await audit("deactivate", "wb_member", member.id, { active: true }, { active: false });
    }
  }

  // what the projector owned for him; v1's rows were closed above
  const projections = await tx
    .update(wbProjection)
    .set({ closedAt: now, close: "VOID", updatedAt: now })
    .where(and(eq(wbProjection.personId, personId), isNull(wbProjection.closedAt), inArray(wbProjection.kind, ["ABSENCE", "DUTY"])))
    .returning({ id: wbProjection.id });

  const counts = { duties: duties.length, assignments: stood.length, withdrawn: withdrawn.length, grants, account: !!member?.active, projections: projections.length };
  await audit("remove-from-roster", "person", personId, null, counts);
  return { recordIds: withdrawn.map((r) => r.id), rfIds, counts };
}

/** Edits to cards already out; nothing new goes to any chat. */
export async function redrawAfter(c: Courier, cleanup: Cleanup) {
  for (const id of cleanup.recordIds) await c.redraw({ record: id });
  for (const id of cleanup.rfIds) await c.redraw({ rf: id });
}

/** Remove from roster in the Mini App: v1's removal and the whereabouts cleanup, in one Write. */
export async function removeFromRoster(courier: Courier, by: Acting, personId: string) {
  return write(courier, by, {
    parade: true,
    async change(c) {
      const tx = asTx(c.tx);
      const p = await personWhere(personId, tx);
      if (!p) throw new Refusal("He's no longer on the roster.");
      if (!canRemoveFromRoster(by.actor.grants, p)) throw new Refusal(`Only ${p.subunitName}'s PC or PS (or company command) can remove ${p.rank} ${p.name}.`);
      const self = removalRefusal({ self: by.actor.personId === personId, lastAdmin: false });
      if (self) throw new Refusal(self);
      const [row] = await tx.select({ active: person.active }).from(person).where(eq(person.id, personId)).for("update");
      if (!row?.active) throw new Refusal("He's already been taken off the roster.");
      await ensureProjectorUser(tx);
      await removePersonCore(tx, PROJECTOR_USER.id, personId);
      const cleanup = await cleanupWhereabouts(c, by, personId, { label: await memberLabel(by.actor.id, tx), v1UserId: PROJECTOR_USER.id });
      return { name: `${p.rank} ${p.name}`, cleanup };
    },
    async tell({ name, cleanup }, c) {
      await redrawAfter(c, cleanup);
      return { name, ...cleanup.counts };
    },
  });
}

/**
 * v1's Admin › People › Remove, when FEATURE_WHEREABOUTS is on: the same
 * cleanup, joining v1's transaction. Returns what to do once it has committed:
 * bring the parade state in line and redraw the cards.
 */
export async function removeFromWhereabouts(tx: Tx, personId: string, v1: { v1UserId: string; v1Name: string }): Promise<() => Promise<void>> {
  const by: By = { system: "WEB", label: v1.v1Name };
  const { finish } = await joinWrite(tx, liveCourier, by, {
    parade: true,
    change: (c) => cleanupWhereabouts(c, by, personId, { label: v1.v1Name, v1UserId: v1.v1UserId }),
    tell: (cleanup, c) => redrawAfter(c, cleanup),
  });
  return async () => {
    try {
      await finish();
    } catch (e) {
      console.error("wb roster removal redraw:", e);
    }
  };
}

// ------------------------------------------------------------------ add

export interface NewRosterPerson {
  memberId: string;
  campId: string;
  rank: string;
  name: string;
  role: string;
}

/** The account waiting to be added, if the actor can see him on Roster. */
async function waitingMember(tx: Db, actor: Acting["actor"], memberId: string) {
  const [row] = await tx
    .select({ m: wbMember, campId: camp.id, subunitId: camp.subunitId })
    .from(wbMember)
    .leftJoin(camp, eq(camp.id, wbMember.selfCampId))
    .where(eq(wbMember.id, memberId));
  if (!row || !row.m.active || !row.m.registeredAt) throw new Refusal("That account is no longer waiting.");
  if (!inRosterScope(actor.grants, { subunitId: row.subunitId, campId: row.campId })) throw new Refusal("He isn't in your platoon or camp.");
  if (row.m.personId) throw new Refusal("Someone has just added him.");
  return { member: row.m, campId: row.campId };
}

/** Link the account to the person, unless someone beat us to it. Inside the Write. */
async function link({ tx, audit }: Change, memberId: string, personId: string) {
  let rows;
  try {
    rows = await tx
      .update(wbMember)
      .set({ personId, source: "ROSTER" })
      .where(and(eq(wbMember.id, memberId), isNull(wbMember.personId), eq(wbMember.active, true)))
      .returning({ id: wbMember.id });
  } catch (e) {
    if (uniqueViolation(e)) throw new Refusal("Someone else is already registered as that person.");
    throw e;
  }
  if (!rows.length) throw new Refusal("Someone has just added him.");
  await audit({ action: "link", entity: "wb_member", entityId: memberId, before: { personId: null }, after: { personId } });
}

async function tell(c: Courier, telegramUserId: number, personId: string) {
  const p = await personWhere(personId);
  await c.send({ telegramId: telegramUserId }, addedText(p ? place(p.campName, p.subunitName) : ""), [[{ text: "Open Sabre", route: "" }]]);
}

export interface PersonInput {
  campId: string;
  rank: string;
  name: string;
  role: string;
}

interface Target {
  id: string;
  name: string;
  subunitId: string;
  isHq: boolean;
}

/**
 * What every add or edit checks before writing: a camp in the actor's Roster
 * scope, a rank from the list, a name, and a role that fits the camp. `keep` is
 * the man's rank and role as v1 has them: sent back untouched they stay, even
 * if they're free text from the old roster ("GUARD COMM").
 */
async function checkPerson(tx: Db, actor: Acting["actor"], input: PersonInput, keep?: { rank: string; role: string }) {
  const [target] = await tx
    .select({ id: camp.id, name: camp.name, subunitId: camp.subunitId, isHq: subunit.isHq })
    .from(camp)
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(eq(camp.id, input.campId));
  if (!target) throw new Refusal("Pick his camp again.");
  if (!inRosterScope(actor.grants, { subunitId: target.subunitId, campId: target.id })) throw new Refusal(`${target.name} isn't in your platoon or camp.`);
  const rank = input.rank.trim().toUpperCase();
  const name = input.name.trim().toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  if (!(RANKS as readonly string[]).includes(rank) && rank !== keep?.rank) throw new Refusal("Pick his rank.");
  if (name.length < 2) throw new Refusal("Type his name as it should be on the parade state.");
  const kept = !!keep && input.role === keep.role;
  if (!kept && !rolesFor(target.isHq).includes(input.role)) throw new Refusal("Pick a role that fits that camp.");
  return { target: target as Target, values: { campId: target.id, rank, name, role: input.role } };
}

/** Someone else active in that camp under that name. Inside the transaction, so a race meets v1's unique index instead. */
async function refuseDuplicate(tx: Tx, target: Target, name: string, hint: string, exceptId?: string) {
  const [same] = await tx
    .select({ rank: person.rank })
    .from(person)
    .where(and(eq(person.campId, target.id), eq(person.name, name), eq(person.active, true), exceptId ? ne(person.id, exceptId) : undefined));
  if (same) throw new Refusal(`There's already a ${same.rank} ${name} in ${target.name}. ${hint}`);
}

/**
 * Add to roster (a waiting account): a v1 person from what he registered with
 * (checked by the PS), linked to his account. Nothing of his is on the parade
 * state yet. v1's duplicate-name UserError, if someone added the same name in
 * between, comes back as a refusal.
 */
export async function addToRoster(courier: Courier, by: Acting, input: NewRosterPerson) {
  return write(courier, by, {
    parade: false,
    async change(c) {
      const tx = asTx(c.tx);
      const w = await waitingMember(tx, by.actor, input.memberId);
      const { target, values } = await checkPerson(tx, by.actor, input);
      await refuseDuplicate(tx, target, values.name, "Link him to that person, or add a surname.");
      await ensureProjectorUser(tx);
      const row = await savePersonCore(tx, PROJECTOR_USER.id, values);
      await c.audit({ action: "roster-add", entity: "person", entityId: row.id, after: { memberId: input.memberId, ...values } });
      await link(c, input.memberId, row.id);
      return { personId: row.id, telegramUserId: w.member.telegramUserId, label: `${values.rank} ${values.name}` };
    },
    async tell({ personId, telegramUserId, label }, c) {
      await tell(c, telegramUserId, personId);
      return { personId, label };
    },
  });
}

/** Link to existing (a waiting account): he's on the roster already, under a name nobody has registered as. */
export async function linkToRoster(courier: Courier, by: Acting, memberId: string, personId: string) {
  return write(courier, by, {
    parade: false,
    async change(c) {
      const tx = asTx(c.tx);
      const w = await waitingMember(tx, by.actor, memberId);
      const p = await personWhere(personId, tx);
      if (!p) throw new Refusal("That person is no longer on the roster.");
      if (!inRosterScope(by.actor.grants, p)) throw new Refusal(`${p.rank} ${p.name} isn't in your platoon or camp.`);
      if (p.campId !== w.campId) throw new Refusal(`${p.rank} ${p.name} is in ${p.campName}, not the camp he registered with.`);
      const [taken] = await tx.select({ id: wbMember.id }).from(wbMember).where(eq(wbMember.personId, personId));
      if (taken) throw new Refusal("Someone else is already registered as that person.");
      await link(c, memberId, personId);
      return { telegramUserId: w.member.telegramUserId, label: `${p.rank} ${p.name}` };
    },
    async tell({ telegramUserId, label }, c) {
      await tell(c, telegramUserId, personId);
      return { label };
    },
  });
}

// ------------------------------------------------------------------ add and edit (Roster)

/**
 * + Add person on Roster: a man who hasn't opened Sabre yet. Nobody is linked
 * and nobody is told; registering later finds him by name like anyone else.
 */
export async function addPersonToRoster(by: Acting, input: PersonInput) {
  return write(null, by, {
    parade: false,
    async change(c) {
      const tx = asTx(c.tx);
      const { target, values } = await checkPerson(tx, by.actor, input);
      await refuseDuplicate(tx, target, values.name, "Add a surname to tell them apart.");
      await ensureProjectorUser(tx);
      const row = await savePersonCore(tx, PROJECTOR_USER.id, values);
      await c.audit({ action: "roster-add", entity: "person", entityId: row.id, after: values });
      return { personId: row.id, label: `${values.rank} ${values.name}` };
    },
  });
}

/**
 * Edit on Roster: rank, name, role, or a move to another camp. Both the camp
 * he's in and the one he's going to must be in the actor's Roster scope, so a
 * GC can't send a man out of his camp; a move puts him at the end of the new
 * one, and the parade state is brought in line (he counts somewhere else now).
 */
export async function editRosterPerson(by: Acting, personId: string, input: PersonInput) {
  return write(null, by, {
    parade: true,
    async change(c) {
      const tx = asTx(c.tx);
      const p = await personWhere(personId, tx);
      if (!p) throw new Refusal("He's no longer on the roster.");
      if (!inRosterScope(by.actor.grants, p)) throw new Refusal(`${p.rank} ${p.name} isn't in your platoon or camp.`);
      const [before] = await tx.select().from(person).where(eq(person.id, personId)).for("update");
      if (!before?.active) throw new Refusal("He's no longer on the roster.");
      if (before.campId !== p.campId) throw new Refusal("Someone has just moved him. Open Roster again.");
      const { target, values } = await checkPerson(tx, by.actor, input, before);
      const done = { moved: target.id !== p.campId, label: `${values.rank} ${values.name}`, campName: target.name };
      const same = before.rank === values.rank && before.name === values.name && before.role === values.role && before.campId === values.campId;
      if (same) return { changed: false, ...done };
      await refuseDuplicate(tx, target, values.name, "Add a surname to tell them apart.", personId);
      await ensureProjectorUser(tx);
      await savePersonCore(tx, PROJECTOR_USER.id, { personId, ...values });
      await c.audit({
        action: "roster-edit",
        entity: "person",
        entityId: personId,
        before: { campId: before.campId, rank: before.rank, name: before.name, role: before.role },
        after: values,
      });
      return { changed: true, ...done };
    },
  });
}
