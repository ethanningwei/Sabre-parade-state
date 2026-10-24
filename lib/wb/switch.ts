import "server-only";
import { and, asc, eq, gt, inArray, isNull, max, or, sql } from "drizzle-orm";
import { endDutyCore } from "@/lib/core/duties";
import { removePersonCore, savePersonCore } from "@/lib/core/people";
import { writeAudit, type Tx } from "@/lib/core/audit";
import { getCoy } from "@/lib/data/snapshot";
import { absence, camp, duty, person, subunit } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import {
  wbAssignment,
  wbChangeover,
  wbCommanderChat,
  wbDraftGrant,
  wbDraftPlacement,
  wbDraftPlatoon,
  wbDraftSection,
  wbGrant,
  wbMember,
  wbPhase,
  wbProjection,
  wbRecord,
} from "@/lib/wb/db/schema";
import { emptyLog, isSvc, rosterOrder, sectionCampName, sectionOrder, type ChangeoverLog, type LoggedGrant, type LoggedRemoval } from "@/lib/wb/domain/rot";
import { checklist, loadDraft, runsChangeover } from "@/lib/wb/changeover-data";
import { ensureProjectorUser, PROJECTOR_USER } from "@/lib/wb/projection";
import { memberLabel, type Db } from "@/lib/wb/records";
import { recountRequest } from "@/lib/wb/rf";
import { cleanupWhereabouts, redrawAfter } from "@/lib/wb/roster-flow";
import type { Courier } from "@/lib/wb/telegram/courier";
import { write, type Acting } from "@/lib/wb/write";

// Switch to ROT and Switch back (phases-plan §3.4, mockup 7). The ROT
// structure becomes v1 rows: each drafted platoon a subunit, each section a
// camp (always on shift), and the men move there through v1's savePersonCore.
// One Write does the structure, the moves, the end of live Extra/RF/SOL, the
// grants and the phase; then each SVC trooper is taken off the roster in his
// own Write, as ORD does, so one refusal (the last admin) doesn't stop the
// rest. Everything is logged in wb_changeover.log, and Switch back puts it
// all back the same way (the user, 2026-10-24: SVC troopers included, their
// withdrawn requests pending again; PC/PS grants replaced by the drafted ones).

const asTx = (t: Db) => t as Tx;

const logGrant = (g: typeof wbGrant.$inferSelect): LoggedGrant => ({
  memberId: g.memberId,
  role: g.role,
  subunitId: g.subunitId,
  campId: g.campId,
  grantedBy: g.grantedBy,
  grantedAt: g.grantedAt.toISOString(),
});

async function gate(tx: Db, by: Acting) {
  if (!(await runsChangeover(by.actor, tx))) throw new Refusal("Only COY HQ and admins can switch.");
}

/** Lock the phase row, so two switches can't run at once. */
async function lockPhase(tx: Db, coyId: string) {
  await tx.insert(wbPhase).values({ coyId }).onConflictDoNothing();
  const [row] = await tx.select().from(wbPhase).where(eq(wbPhase.coyId, coyId)).for("update");
  return row;
}

export interface SwitchResult {
  changeoverId: string;
  moved: number;
  platoons: number;
  sections: number;
  grantsAdded: number;
  grantsRemoved: number;
  ended: number;
  /** SVC troopers taken off the roster */
  removed: number;
  /** kept on the roster: the last admin, or a removal that failed */
  kept: string[];
  /** drafted commanders with no Sabre account, so no grant */
  unregistered: string[];
}

/** Switch to ROT. Refused unless every combat trooper has a section (the checklist's `ready`). */
export async function switchToRot(courier: Courier, by: Acting, now: Date = new Date()) {
  const coy = await getCoy();
  const draft = await loadDraft(coy);
  const ready = checklist(draft);
  if (draft.phase.phase !== "VIGILANCE") return { ok: false as const, error: "The company is in ROT already." };
  if (!ready.ready) return { ok: false as const, error: ready.blockers.join(" ") };
  const order = rosterOrder(draft.snapshot);

  const main = await write(courier, by, {
    parade: true,
    async change({ tx: t, audit }) {
      const tx = asTx(t);
      await gate(t, by);
      const phase = await lockPhase(t, coy.id);
      if (phase.phase !== "VIGILANCE") throw new Refusal("Someone has just switched to ROT.");
      await ensureProjectorUser(tx);
      const log = emptyLog();

      // the draft as it stands now, inside the lock
      const platoons = await tx.select().from(wbDraftPlatoon).where(eq(wbDraftPlatoon.coyId, coy.id)).orderBy(asc(wbDraftPlatoon.sortOrder), asc(wbDraftPlatoon.createdAt));
      const sections = await tx
        .select()
        .from(wbDraftSection)
        .where(inArray(wbDraftSection.platoonId, platoons.map((p) => p.id)))
        .orderBy(asc(wbDraftSection.sortOrder), asc(wbDraftSection.createdAt));
      const placements = await tx.select().from(wbDraftPlacement).where(inArray(wbDraftPlacement.sectionId, sections.map((s) => s.id)));
      const drafted = await tx
        .select()
        .from(wbDraftGrant)
        .where(or(inArray(wbDraftGrant.platoonId, platoons.map((p) => p.id)), inArray(wbDraftGrant.sectionId, sections.map((s) => s.id))));

      // every combat trooper outside COY HQ has a section (checked again, inside the lock)
      const everyone = await tx
        .select({ id: person.id, rank: person.rank, name: person.name, role: person.role, campId: person.campId, sortOrder: person.sortOrder })
        .from(person)
        .innerJoin(camp, eq(camp.id, person.campId))
        .innerJoin(subunit, eq(subunit.id, camp.subunitId))
        .where(and(eq(camp.coyId, coy.id), eq(subunit.isHq, false), eq(person.active, true)));
      const placedIds = new Set(placements.map((p) => p.personId));
      const missing = everyone.filter((p) => !isSvc(p.role) && !placedIds.has(p.id));
      if (missing.length) throw new Refusal(`${missing.length} men still need a section (someone has just added them). Place them, then switch.`);

      // the Vigilance platoons and camps, hidden from now on (a drafted platoon of the same name is reused)
      const subunits = await tx.select().from(subunit).where(and(eq(subunit.coyId, coy.id), eq(subunit.isHq, false)));
      const oldCamps = await tx.select({ id: camp.id, name: camp.name }).from(camp).where(inArray(camp.subunitId, subunits.map((s) => s.id)));
      log.hiddenCamps = oldCamps.map((c) => c.id);

      // platoons → subunits, sections → camps
      const [{ lastSort }] = await tx.select({ lastSort: max(subunit.sortOrder) }).from(subunit).where(eq(subunit.coyId, coy.id));
      const subunitOf = new Map<string, string>();
      for (const [i, pl] of platoons.entries()) {
        const sortOrder = (lastSort ?? 0) + 1 + i;
        const same = subunits.find((s) => s.name === pl.name);
        let id = same?.id;
        if (same) {
          // in the draft's order, after every Vigilance platoon
          log.reused!.push({ subunitId: same.id, sortOrder: same.sortOrder });
          await tx.update(subunit).set({ sortOrder }).where(eq(subunit.id, same.id));
        } else {
          [{ id }] = await tx.insert(subunit).values({ coyId: coy.id, name: pl.name, isHq: false, sortOrder }).returning({ id: subunit.id });
          log.subunits.push(id!);
          await writeAudit(tx, PROJECTOR_USER.id, "create-subunit", "subunit", id!, null, { name: pl.name, by: "switch-to-rot" });
        }
        if (!id) throw new Error("switch: no subunit");
        subunitOf.set(pl.id, id);
        await tx.update(wbDraftPlatoon).set({ subunitId: id }).where(eq(wbDraftPlatoon.id, pl.id));
        // a commanders chat kept from an earlier Switch back
        if (pl.chatId) await tx.insert(wbCommanderChat).values({ subunitId: id, chatId: pl.chatId, threadId: pl.threadId, chatTitle: pl.chatTitle ?? "" }).onConflictDoNothing();
      }
      log.hiddenSubunits = subunits.filter((s) => ![...subunitOf.values()].includes(s.id)).map((s) => s.id);
      const campOf = new Map<string, string>();
      for (const pl of platoons) {
        for (const [i, sec] of sections.filter((s) => s.platoonId === pl.id).entries()) {
          const name = sectionCampName(pl.name, sec.name);
          if (oldCamps.some((c) => c.name === name)) throw new Refusal(`A camp called ${name} exists already. Rename the section.`);
          const [{ id }] = await tx.insert(camp).values({ coyId: coy.id, subunitId: subunitOf.get(pl.id)!, name, sortOrder: i, onShift: true }).returning({ id: camp.id });
          log.camps.push(id);
          campOf.set(sec.id, id);
          await tx.update(wbDraftSection).set({ campId: id }).where(eq(wbDraftSection.id, sec.id));
          await writeAudit(tx, PROJECTOR_USER.id, "create-camp", "camp", id, null, { name, by: "switch-to-rot" });
        }
      }

      // the men, section by section: SCs first, then as they stand on the roster today
      const scOf = new Map(drafted.filter((g) => g.role === "SC").map((g) => [g.personId, g.sectionId]));
      for (const sec of sections) {
        const here = placements.filter((p) => p.sectionId === sec.id).map((p) => p.personId);
        const scIds = here.filter((id) => scOf.get(id) === sec.id);
        for (const id of sectionOrder(here, scIds, order)) {
          const p = everyone.find((x) => x.id === id);
          if (!p) continue; // gone from the roster since he was placed
          const toRole = scIds.includes(id) ? "SC" : "CBT";
          await savePersonCore(tx, PROJECTOR_USER.id, { personId: id, campId: campOf.get(sec.id)!, rank: p.rank, name: p.name, role: toRole });
          log.moves.push({ personId: id, fromCampId: p.campId, toCampId: campOf.get(sec.id)!, role: p.role, toRole, sortOrder: p.sortOrder });
        }
      }

      // live Extra/RF/SOL end: Sabre's assignments, and v1's open duties with their home absences
      const ended = await tx
        .update(wbAssignment)
        .set({ state: "CANCELLED", cancelledBy: by.actor.id, cancelledAt: now })
        .where(and(eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now), inArray(wbAssignment.campId, log.hiddenCamps)))
        .returning({ id: wbAssignment.id, rfRequestId: wbAssignment.rfRequestId });
      log.assignments = ended.map((a) => a.id);
      for (const rf of new Set(ended.flatMap((a) => (a.rfRequestId ? [a.rfRequestId] : [])))) await recountRequest(t, rf);
      const duties = await tx.select({ id: duty.id }).from(duty).where(and(eq(duty.coyId, coy.id), isNull(duty.closedAt)));
      for (const d of duties) {
        const home = await tx.select({ id: absence.id }).from(absence).where(and(eq(absence.dutyId, d.id), isNull(absence.closedAt)));
        await endDutyCore(tx, PROJECTOR_USER.id, d.id);
        log.duties.push(d.id);
        log.dutyAbsences.push(...home.map((a) => a.id));
      }

      // grants: GCs and the Vigilance platoons' PCs and PSes go; the drafted SCs, PCs and PSes come
      const old = await tx
        .select()
        .from(wbGrant)
        .where(or(eq(wbGrant.role, "GC"), and(inArray(wbGrant.role, ["PC", "PS"]), inArray(wbGrant.subunitId, subunits.map((s) => s.id)))));
      for (const g of old) {
        await tx.delete(wbGrant).where(eq(wbGrant.id, g.id));
        log.grantsRemoved.push(logGrant(g));
        await audit({ action: "revoke", entity: "wb_grant", entityId: g.id, before: g, after: { reason: "switch to ROT" } });
      }
      for (const g of drafted) {
        const [m] = await tx
          .select({ id: wbMember.id, rank: person.rank, name: person.name })
          .from(person)
          .leftJoin(wbMember, and(eq(wbMember.personId, person.id), eq(wbMember.active, true), sql`${wbMember.registeredAt} is not null`))
          .where(eq(person.id, g.personId));
        if (!m?.id) {
          if (m) log.unregistered.push(`${m.rank} ${m.name} (${g.role})`);
          continue;
        }
        const scope = g.sectionId ? { subunitId: null, campId: campOf.get(g.sectionId) ?? null } : { subunitId: subunitOf.get(g.platoonId!) ?? null, campId: null };
        const [row] = await tx.insert(wbGrant).values({ memberId: m.id, role: g.role, ...scope, grantedBy: by.actor.id }).onConflictDoNothing().returning();
        if (row) {
          log.grantsAdded.push(row.id);
          await audit({ action: "grant", entity: "wb_grant", entityId: row.id, after: { ...row, reason: "switch to ROT" } });
        }
      }

      const [changeover] = await tx.insert(wbChangeover).values({ coyId: coy.id, to: "ROT", switchedAt: now, switchedBy: by.actor.id, log }).returning({ id: wbChangeover.id });
      await tx.update(wbPhase).set({ phase: "ROT", changeoverId: changeover.id, updatedAt: now, updatedBy: by.actor.id }).where(eq(wbPhase.coyId, coy.id));
      const svc = everyone.filter((p) => isSvc(p.role));
      const counts = { moved: log.moves.length, platoons: platoons.length, sections: sections.length, grantsAdded: log.grantsAdded.length, grantsRemoved: log.grantsRemoved.length, ended: log.assignments.length + log.duties.length };
      await audit({ action: "switch-to-rot", entity: "wb_changeover", entityId: changeover.id, after: { ...counts, svc: svc.length, unregistered: log.unregistered } });
      return { changeoverId: changeover.id, svc: svc.map((p) => ({ id: p.id, label: `${p.rank} ${p.name}` })), counts, unregistered: log.unregistered };
    },
    async tell(v) {
      return v;
    },
  });
  if (!main.ok) return main;

  // the SVC troopers, one Write each, as ORD does
  const label = await memberLabel(by.actor.id);
  let removed = 0;
  const kept: string[] = [];
  for (const svc of main.value.svc) {
    try {
      const res = await removeSvc(courier, by, main.value.changeoverId, svc.id, label, now);
      if (res.ok) removed++;
      else kept.push(`${svc.label}: ${res.error}`);
    } catch (e) {
      console.error(`wb switch: removing ${svc.id}`, e);
      kept.push(`${svc.label}: something went wrong`);
    }
  }
  const value: SwitchResult = { changeoverId: main.value.changeoverId, ...main.value.counts, removed, kept, unregistered: main.value.unregistered };
  return { ok: true as const, value };
}

/** One SVC trooper off the roster, with what it takes logged on the changeover so Switch back can return it. */
async function removeSvc(courier: Courier, by: Acting, changeoverId: string, personId: string, label: string, now: Date) {
  return write(courier, by, {
    parade: true,
    async change(c) {
      const tx = asTx(c.tx);
      const [p] = await tx.select({ active: person.active }).from(person).where(eq(person.id, personId)).for("update");
      if (!p?.active) throw new Refusal("He's already off the roster.");
      const [member] = await tx.select().from(wbMember).where(eq(wbMember.personId, personId));
      const [absences, duties, assignments, records, grants, projections] = await Promise.all([
        tx.select({ id: absence.id }).from(absence).where(and(eq(absence.personId, personId), isNull(absence.closedAt))),
        tx.select({ id: duty.id }).from(duty).where(and(eq(duty.personId, personId), isNull(duty.closedAt))),
        tx.select({ id: wbAssignment.id }).from(wbAssignment).where(and(eq(wbAssignment.personId, personId), eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now))),
        tx.select({ id: wbRecord.id }).from(wbRecord).where(and(eq(wbRecord.personId, personId), eq(wbRecord.state, "PENDING"))),
        member ? tx.select().from(wbGrant).where(eq(wbGrant.memberId, member.id)) : Promise.resolve([]),
        tx.select({ id: wbProjection.id }).from(wbProjection).where(and(eq(wbProjection.personId, personId), isNull(wbProjection.closedAt), inArray(wbProjection.kind, ["ABSENCE", "DUTY"]))),
      ]);
      const dutyAbsences = duties.length ? await tx.select({ id: absence.id }).from(absence).where(and(inArray(absence.dutyId, duties.map((d) => d.id)), isNull(absence.closedAt))) : [];
      await ensureProjectorUser(tx);
      await removePersonCore(tx, PROJECTOR_USER.id, personId);
      const cleanup = await cleanupWhereabouts(c, by, personId, { label, v1UserId: PROJECTOR_USER.id }, now);
      const entry: LoggedRemoval = {
        personId,
        absenceIds: absences.map((a) => a.id),
        dutyIds: duties.map((d) => d.id),
        dutyAbsenceIds: dutyAbsences.map((a) => a.id),
        assignmentIds: assignments.map((a) => a.id),
        recordIds: records.map((r) => r.id),
        memberId: member?.id ?? null,
        memberActive: !!member?.active,
        grants: grants.map(logGrant),
        projectionIds: projections.map((p) => p.id),
      };
      await tx
        .update(wbChangeover)
        .set({ log: sql`jsonb_set(${wbChangeover.log}, '{removed}', (${wbChangeover.log} -> 'removed') || ${JSON.stringify([entry])}::jsonb)` })
        .where(eq(wbChangeover.id, changeoverId));
      return cleanup;
    },
    async tell(cleanup, c) {
      await redrawAfter(c, cleanup);
      return cleanup.counts;
    },
  });
}

// ------------------------------------------------------------------ Switch back

export interface SwitchBackResult {
  moved: number;
  restored: number;
  reopened: number;
  /** what couldn't come back, in words */
  notes: string[];
}

/**
 * Switch back to Vigilance: everything the switch did, undone from its log.
 * Men go back to their camps, roles and places on the roster; the v1
 * platoons and sections it made are deleted; SVC troopers come back with
 * their accounts, grants, MC/leave, Extra/RF/SOL and pending requests; the
 * Extra/RF/SOL it ended and the grants it replaced come back. Refused if
 * something made during ROT would be lost with a section (a man added to
 * one, an Extra/RF/SOL recorded there).
 */
export async function switchBack(courier: Courier, by: Acting, now: Date = new Date()) {
  const coy = await getCoy();
  return write(courier, by, {
    parade: true,
    async change({ tx: t, audit }) {
      const tx = asTx(t);
      await gate(t, by);
      const phase = await lockPhase(t, coy.id);
      if (phase.phase !== "ROT" || !phase.changeoverId) throw new Refusal("The company isn't in ROT.");
      const [co] = await tx.select().from(wbChangeover).where(eq(wbChangeover.id, phase.changeoverId)).for("update");
      if (!co || co.undoneAt) throw new Refusal("That switch has been undone already.");
      const log = co.log as ChangeoverLog;
      await ensureProjectorUser(tx);
      const notes: string[] = [];

      // nothing made during ROT may go down with a section
      const moved = new Set(log.moves.map((m) => m.personId));
      const strangers = log.camps.length
        ? (await tx.select({ id: person.id, rank: person.rank, name: person.name }).from(person).where(and(inArray(person.campId, log.camps), eq(person.active, true)))).filter((p) => !moved.has(p.id))
        : [];
      if (strangers.length) throw new Refusal(`${strangers.map((p) => `${p.rank} ${p.name}`).join(", ")} joined a section during ROT. Move ${strangers.length === 1 ? "him" : "them"} to a Vigilance camp on Roster first.`);
      const rotDuties = log.camps.length ? await tx.select({ id: duty.id, name: duty.name }).from(duty).where(inArray(duty.campId, log.camps)) : [];
      if (rotDuties.length) throw new Refusal(`An Extra/RF/SOL was recorded at a section during ROT (${rotDuties.map((d) => d.name).join(", ")}). It can't be moved back automatically.`);

      // an absence reopens only if he has no other open one now (v1 allows one)
      const reopen = async (ids: readonly string[]) => {
        let n = 0;
        for (const id of ids) {
          const [a] = await tx.select({ personId: absence.personId }).from(absence).where(eq(absence.id, id));
          if (!a) continue;
          const [open] = await tx.select({ id: absence.id }).from(absence).where(and(eq(absence.personId, a.personId), isNull(absence.closedAt)));
          if (open) {
            if (open.id !== id) notes.push("An absence closed by the switch wasn't reopened: he has a newer one.");
            continue;
          }
          await tx.update(absence).set({ closedAt: null, closedBy: null }).where(eq(absence.id, id));
          await writeAudit(tx, PROJECTOR_USER.id, "reopen-absence", "absence", id, null, { by: "switch-back" });
          n++;
        }
        return n;
      };
      const restoreGrants = async (grants: readonly LoggedGrant[]) => {
        for (const g of grants) {
          const [row] = await tx
            .insert(wbGrant)
            .values({ memberId: g.memberId, role: g.role as typeof wbGrant.$inferInsert.role, subunitId: g.subunitId, campId: g.campId, grantedBy: g.grantedBy, grantedAt: new Date(g.grantedAt) })
            .onConflictDoNothing()
            .returning({ id: wbGrant.id });
          if (row) await audit({ action: "grant", entity: "wb_grant", entityId: row.id, after: { ...g, reason: "switch back" } });
        }
      };
      const restoreAssignments = async (ids: readonly string[]) => {
        if (!ids.length) return 0;
        const back = await tx
          .update(wbAssignment)
          .set({ state: "ACTIVE", cancelledBy: null, cancelledAt: null })
          .where(and(inArray(wbAssignment.id, [...ids]), eq(wbAssignment.state, "CANCELLED")))
          .returning({ id: wbAssignment.id, rfRequestId: wbAssignment.rfRequestId });
        for (const rf of new Set(back.flatMap((a) => (a.rfRequestId ? [a.rfRequestId] : [])))) await recountRequest(t, rf);
        for (const a of back) await audit({ action: "restore-assignment", entity: "wb_assignment", entityId: a.id, after: { state: "ACTIVE", reason: "switch back" } });
        return back.length;
      };
      const restoreDuties = async (ids: readonly string[]) => {
        if (!ids.length) return;
        await tx.update(duty).set({ closedAt: null, closedBy: null }).where(inArray(duty.id, [...ids]));
        for (const id of ids) await writeAudit(tx, PROJECTOR_USER.id, "reopen-duty", "duty", id, null, { by: "switch-back" });
      };

      // SVC troopers back on the roster, with everything that went with them
      const recordIds: string[] = [];
      let reopened = 0;
      for (const r of log.removed) {
        await tx.update(person).set({ active: true }).where(eq(person.id, r.personId));
        await writeAudit(tx, PROJECTOR_USER.id, "restore-person", "person", r.personId, { active: false }, { active: true, by: "switch-back" });
        reopened += await reopen(r.absenceIds);
        await restoreDuties(r.dutyIds);
        reopened += await reopen(r.dutyAbsenceIds);
        await restoreAssignments(r.assignmentIds);
        if (r.recordIds.length) {
          const back = await tx
            .update(wbRecord)
            .set({ state: "PENDING", decisionNote: null, updatedAt: now })
            .where(and(inArray(wbRecord.id, r.recordIds), eq(wbRecord.state, "WITHDRAWN")))
            .returning({ id: wbRecord.id });
          for (const b of back) await audit({ action: "restore-request", entity: "wb_record", entityId: b.id, before: { state: "WITHDRAWN" }, after: { state: "PENDING", reason: "switch back" } });
          recordIds.push(...back.map((b) => b.id));
        }
        if (r.memberId && r.memberActive) {
          await tx.update(wbMember).set({ active: true }).where(eq(wbMember.id, r.memberId));
          await audit({ action: "activate", entity: "wb_member", entityId: r.memberId, before: { active: false }, after: { active: true, reason: "switch back" } });
        }
        await restoreGrants(r.grants);
        if (r.projectionIds.length) await tx.update(wbProjection).set({ closedAt: null, close: null, updatedAt: now }).where(inArray(wbProjection.id, r.projectionIds));
      }

      // the Extra/RF/SOL the switch ended
      await restoreAssignments(log.assignments);
      await restoreDuties(log.duties);
      reopened += await reopen(log.dutyAbsences);

      // grants: the drafted ones go, the replaced ones come back
      if (log.grantsAdded.length) {
        const gone = await tx.delete(wbGrant).where(inArray(wbGrant.id, log.grantsAdded)).returning();
        for (const g of gone) await audit({ action: "revoke", entity: "wb_grant", entityId: g.id, before: g, after: { reason: "switch back" } });
      }
      await restoreGrants(log.grantsRemoved);

      // the men back to their camps, roles and places
      for (const m of [...log.moves].reverse()) {
        const [p] = await tx.select({ rank: person.rank, name: person.name }).from(person).where(eq(person.id, m.personId));
        if (!p) continue;
        await savePersonCore(tx, PROJECTOR_USER.id, { personId: m.personId, campId: m.fromCampId, rank: p.rank, name: p.name, role: m.role });
        await tx.update(person).set({ sortOrder: m.sortOrder }).where(eq(person.id, m.personId));
      }

      // the platoons and sections it made: their commanders chats are kept on the draft for next time
      for (const subunitId of log.subunits) {
        const [chat] = await tx.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, subunitId));
        if (chat) await tx.update(wbDraftPlatoon).set({ chatId: chat.chatId, threadId: chat.threadId, chatTitle: chat.chatTitle }).where(eq(wbDraftPlatoon.subunitId, subunitId));
      }
      for (const r of log.reused ?? []) await tx.update(subunit).set({ sortOrder: r.sortOrder }).where(eq(subunit.id, r.subunitId));
      if (log.camps.length) await tx.delete(camp).where(inArray(camp.id, log.camps));
      if (log.subunits.length) await tx.delete(subunit).where(inArray(subunit.id, log.subunits));
      for (const id of [...log.camps, ...log.subunits]) await writeAudit(tx, PROJECTOR_USER.id, "delete-structure", "camp/subunit", id, null, { by: "switch-back" });

      await tx.update(wbChangeover).set({ undoneAt: now, undoneBy: by.actor.id }).where(eq(wbChangeover.id, co.id));
      await tx.update(wbPhase).set({ phase: "VIGILANCE", changeoverId: null, updatedAt: now, updatedBy: by.actor.id }).where(eq(wbPhase.coyId, coy.id));
      const result: SwitchBackResult = { moved: log.moves.length, restored: log.removed.length, reopened, notes: [...new Set(notes)] };
      await audit({ action: "switch-back", entity: "wb_changeover", entityId: co.id, after: result });
      return { result, recordIds };
    },
    async tell({ result, recordIds }, c) {
      for (const id of recordIds) await c.redraw({ record: id });
      return result;
    },
  });
}
