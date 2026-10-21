import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { camp } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import { wbAssignment, wbRfRequest } from "@/lib/wb/db/schema";
import {
  ASSIGNMENT_LABEL,
  assignedText,
  assignRefusal,
  canDeployRf,
  canRaiseRf,
  deployedLabel,
  deployRefusal,
  headDownText,
  rfStateLine,
  sentNotice,
  standDownNotice,
  stateAfter,
  type RfRole,
  type WbAssignmentType,
} from "@/lib/wb/domain/rf";
import type { Range } from "@/lib/wb/domain/timeline";
import { campManningLine } from "@/lib/wb/forecast-data";
import { clashFor, memberLabel, personWhere, type Db } from "@/lib/wb/records";
import { assignmentView, liveAssignments, rfView, type AssignmentView } from "@/lib/wb/rf-data";
import type { Courier } from "@/lib/wb/telegram/courier";
import { write, type Acting, type System } from "@/lib/wb/write";

// RF requests and Extra/RF/SOL: the writes. Each is one Write
// (lib/wb/write.ts): one transaction with its audit row; Telegram is told
// afterwards, and a Telegram failure never undoes anything. A request itself
// is never on the parade state; an assignment is (projection, Phase 6).

const lockPerson = (tx: Db, personId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wb-assign:${personId}`}))`);

/**
 * Bring a request's state in line with the men now on it (OPEN, FILLED), under
 * a lock on the request. Inside the transaction, after an assignment was added
 * or cancelled. Returns the state it's in now.
 */
export async function recountRequest(tx: Db, requestId: string): Promise<string> {
  await tx.select({ id: wbRfRequest.id }).from(wbRfRequest).where(eq(wbRfRequest.id, requestId)).for("update");
  const r = (await rfView(requestId, tx))!;
  const next = stateAfter(r.state, r.need, r.deployed.length);
  if (next !== r.state) await tx.update(wbRfRequest).set({ state: next }).where(eq(wbRfRequest.id, requestId));
  return next;
}

// ------------------------------------------------------------------ raise

export interface NewRequest extends Range {
  campId: string;
  role: RfRole;
  need: number;
  reason: string;
  endAt: Date;
}

/**
 * A camp says it'll be short. The card goes to its platoon's commanders chat
 * and COY HQ's, and the raiser gets his own live copy with Close: plans
 * change, and he's the first to know he no longer needs it.
 */
export async function raiseRf(courier: Courier, by: Acting, input: NewRequest) {
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      const [c] = await tx.select({ id: camp.id, subunitId: camp.subunitId, name: camp.name }).from(camp).where(eq(camp.id, input.campId));
      if (!c) throw new Refusal("That camp no longer exists.");
      if (!canRaiseRf(by.actor.grants, { subunitId: c.subunitId, campId: c.id })) throw new Refusal(`You can't ask for manpower for ${c.name}.`);
      const [row] = await tx
        .insert(wbRfRequest)
        .values({ campId: c.id, role: input.role, need: input.need, startAt: input.startAt, endAt: input.endAt, reason: input.reason, raisedBy: by.actor.id })
        .returning();
      await audit({
        action: "raise-rf",
        entity: "wb_rf_request",
        entityId: row.id,
        after: { campId: c.id, role: row.role, need: row.need, startAt: row.startAt, endAt: row.endAt, reason: row.reason },
      });
      return row.id;
    },
    async tell(id, c) {
      const r = (await rfView(id))!;
      const { delivery, chats } = await c.postCard({ rf: r });
      return { request: r, delivery, chats };
    },
  });
}

// ------------------------------------------------------------------ deploy

/**
 * Send a man to a request. Claimed under a lock on the request, with the
 * count checked inside it, so two commanders tapping Deploy on the last slot
 * can't both send a man: the second is told somebody got there first. A
 * commander deploying is the approval. Being down as away is a warning, never
 * a veto.
 */
export async function deploy(courier: Courier, acting: Acting, requestId: string, personId: string) {
  const { actor } = acting;
  return write(courier, acting, {
    parade: true,
    async change({ tx, audit }) {
      const man = await personWhere(personId, tx);
      if (!man) throw new Refusal("That man is no longer on the roster.");
      if (!canDeployRf(actor.grants, man)) throw new Refusal(`You can't send ${man.rank} ${man.name}: he isn't in your platoon or camp.`);
      // the request's lock first: two commanders on the last slot queue here
      const [locked] = await tx.select({ id: wbRfRequest.id }).from(wbRfRequest).where(eq(wbRfRequest.id, requestId)).for("update");
      if (!locked) throw new Refusal("That request has gone.");
      await lockPerson(tx, personId);
      const r = (await rfView(requestId, tx))!;
      const refusal = deployRefusal(r, man, await liveAssignments(r, [personId], tx));
      if (refusal) throw new Refusal(refusal);
      const away = await clashFor(personId, r, tx);
      const [a] = await tx
        .insert(wbAssignment)
        .values({ personId, type: "RF", campId: r.campId, startAt: r.startAt, endAt: r.endAt!, rfRequestId: r.id, createdBy: actor.id })
        .returning({ id: wbAssignment.id });
      const state = await recountRequest(tx, r.id);
      await audit({ action: "deploy", entity: "wb_assignment", entityId: a.id, after: { rfRequestId: r.id, personId, campId: r.campId, state } });
      return { man, away, assignmentId: a.id };
    },
    async tell({ man, away, assignmentId }, c) {
      await c.redraw({ rf: requestId });
      const r = (await rfView(requestId))!;
      const by = await memberLabel(actor.id);
      // the man that he's going, his own commanders that they're a head down, and whoever asked that it's answered
      await c.send({ person: personId }, sentNotice({ type: "RF", range: r, at: r.campName, home: man.campName, by, viaRequest: true, away }));
      await c.send({ platoon: man.subunitId }, headDownText({ type: "RF", man, range: r, at: r.campName, by, viaRequest: true, away, manning: await campManningLine(man.campId, r) }));
      if (r.raisedById !== actor.id) await c.send({ telegramId: r.raisedByTelegramId }, `✅ ${r.campName} is getting ${deployedLabel(man)}\n\n${rfStateLine(r)}`);
      return { request: r, assignmentId, away };
    },
  });
}

// ------------------------------------------------------------------ close

/** No longer needed. The raiser, or anyone who could raise one for that camp. Men already sent stay sent. */
export async function closeRf(courier: Courier, by: Acting, requestId: string) {
  const { actor } = by;
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      const [locked] = await tx.select({ id: wbRfRequest.id }).from(wbRfRequest).where(eq(wbRfRequest.id, requestId)).for("update");
      const before = locked ? await rfView(requestId, tx) : null;
      if (!before) throw new Refusal("That request has gone.");
      if (before.raisedById !== actor.id && !canRaiseRf(actor.grants, before)) throw new Refusal(`Only whoever asked, or ${before.campName}'s commanders, can close this.`);
      if (before.state !== "OPEN") {
        throw new Refusal(
          before.state === "FILLED" ? "It's already filled. Stand the men down from the request first." : before.state === "EXPIRED" ? "Its shift has passed: it's expired." : "It's already closed.",
        );
      }
      await tx.update(wbRfRequest).set({ state: "CLOSED", closedBy: actor.id, closedAt: new Date() }).where(eq(wbRfRequest.id, requestId));
      await audit({ action: "close-rf", entity: "wb_rf_request", entityId: requestId, before: { state: "OPEN" }, after: { state: "CLOSED" } });
    },
    async tell(_, c) {
      await c.redraw({ rf: requestId });
      return (await rfView(requestId))!;
    },
  });
}

/**
 * The evening round: a request whose shift passed while still OPEN is
 * EXPIRED, and every copy of its card says so (the user, 2026-10-14: that
 * edited card is the notice). Men already sent stay as they are.
 */
const EVENING: System = { system: "SYSTEM" };

export async function expireRfRequests(courier: Courier, now: Date = new Date()): Promise<number> {
  const res = await write(courier, EVENING, {
    parade: false,
    async change({ tx, audit }) {
      const rows = await tx
        .update(wbRfRequest)
        .set({ state: "EXPIRED", closedAt: now })
        .where(and(eq(wbRfRequest.state, "OPEN"), lte(wbRfRequest.endAt, now)))
        .returning({ id: wbRfRequest.id });
      for (const r of rows) await audit({ action: "expire-rf", entity: "wb_rf_request", entityId: r.id, before: { state: "OPEN" }, after: { state: "EXPIRED" } });
      return rows.map((r) => r.id);
    },
    async tell(expired, c) {
      for (const id of expired) await c.redraw({ rf: id });
      return expired.length;
    },
  });
  return res.ok ? res.value : 0;
}

// ------------------------------------------------------------------ stand down

/**
 * Cancel an Extra/RF/SOL: he's back with his own camp. Whoever may send him,
 * whoever put him on it, or (for a request) the camp that asked. A request it
 * filled opens again.
 */
export async function standDown(courier: Courier, acting: Acting, assignmentId: string) {
  const { actor } = acting;
  return write(courier, acting, {
    parade: true,
    async change({ tx, audit }) {
      const a = await assignmentView(assignmentId, tx);
      if (!a) throw new Refusal("That's gone.");
      const req = a.rfRequestId ? await rfView(a.rfRequestId, tx) : null;
      const allowed = canDeployRf(actor.grants, { subunitId: a.subunitId, campId: a.homeCampId }) || (req && (canRaiseRf(actor.grants, req) || req.raisedById === actor.id));
      if (!allowed) throw new Refusal(`You can't stand ${a.rank} ${a.name} down.`);
      const [row] = await tx
        .update(wbAssignment)
        .set({ state: "CANCELLED", cancelledBy: actor.id, cancelledAt: new Date() })
        .where(and(eq(wbAssignment.id, assignmentId), eq(wbAssignment.state, "ACTIVE")))
        .returning({ id: wbAssignment.id });
      if (!row) throw new Refusal("He's already been stood down.");
      const state = a.rfRequestId ? await recountRequest(tx, a.rfRequestId) : undefined;
      await audit({ action: "stand-down", entity: "wb_assignment", entityId: assignmentId, before: { state: "ACTIVE" }, after: { state: "CANCELLED", rfRequestId: a.rfRequestId, request: state } });
      return a;
    },
    async tell(a, c) {
      if (a.rfRequestId) await c.redraw({ rf: a.rfRequestId });
      const by = await memberLabel(actor.id);
      await c.send({ person: a.personId }, standDownNotice({ type: a.type, range: a, at: a.campName, by }));
      await c.send({ platoon: a.subunitId }, `↩️ Stood down by ${by}\n\n${a.rank} ${a.name} (${a.homeCampName})\n${a.line}\n\nBack with ${a.homeCampName}.`);
      return a;
    },
  });
}

// ------------------------------------------------------------------ assign

export interface NewAssignment extends Range {
  type: WbAssignmentType;
  /** where they serve; ignored for SOL (his own camp) */
  campId: string | null;
  personIds: string[];
  note: string;
  endAt: Date;
}

/**
 * Extra, RF or SOL straight onto men, without a request (Sabre Bot's
 * /assign). A commander entering it is the approval. Each man is told; each
 * platoon's commanders get one message with their men, and for Extra/RF what
 * it does to each camp a man leaves.
 */
export async function assign(courier: Courier, acting: Acting, input: NewAssignment) {
  const { actor } = acting;
  return write(courier, acting, {
    parade: true,
    async change({ tx, audit }) {
      const men = await Promise.all(input.personIds.map((id) => personWhere(id, tx)));
      if (men.some((m) => !m)) throw new Refusal("Someone picked is no longer on the roster.");
      const list = men as NonNullable<(typeof men)[number]>[];
      const outside = list.find((m) => !canDeployRf(actor.grants, m));
      if (outside) throw new Refusal(`You can't send ${outside.rank} ${outside.name}: he isn't in your platoon or camp.`);
      let target: { id: string; name: string } | null = null;
      if (input.type !== "SOL") {
        if (!input.campId) throw new Refusal("Pick the camp they're serving at.");
        [target] = await tx.select({ id: camp.id, name: camp.name }).from(camp).where(eq(camp.id, input.campId));
        if (!target) throw new Refusal("That camp no longer exists.");
      }
      const aways = new Map<string, string[]>();
      for (const m of list) aways.set(m.personId, await clashFor(m.personId, input, tx));

      for (const m of [...list].sort((x, y) => x.personId.localeCompare(y.personId))) await lockPerson(tx, m.personId);
      const ids = list.map((m) => m.personId);
      const busy = await liveAssignments(input, ids, tx);
      const refusals = list.map((m) => assignRefusal(input.type, target?.id ?? null, m, input, busy)).filter((x): x is string => !!x);
      if (refusals.length) throw new Refusal(refusals.join("\n"));
      const rows = await tx
        .insert(wbAssignment)
        .values(list.map((m) => ({ personId: m.personId, type: input.type, campId: target?.id ?? m.campId, startAt: input.startAt, endAt: input.endAt, note: input.note, createdBy: actor.id })))
        .returning({ id: wbAssignment.id, personId: wbAssignment.personId, campId: wbAssignment.campId });
      for (const r of rows)
        await audit({ action: "assign", entity: "wb_assignment", entityId: r.id, after: { type: input.type, personId: r.personId, campId: r.campId, startAt: input.startAt, endAt: input.endAt } });
      return { ids: rows.map((r) => r.id), list, target, aways };
    },
    async tell({ ids, list, target, aways }, courier) {
      const by = await memberLabel(actor.id);
      for (const m of list) {
        await courier.send(
          { person: m.personId },
          sentNotice({ type: input.type, range: input, at: target?.name ?? m.campName, home: m.campName, by, viaRequest: false, away: aways.get(m.personId)! }),
        );
      }
      for (const subunitId of new Set(list.map((m) => m.subunitId))) {
        const theirs = list.filter((m) => m.subunitId === subunitId);
        const manning: string[] = [];
        if (input.type !== "SOL") {
          for (const campId of new Set(theirs.map((m) => m.campId))) {
            const line = await campManningLine(campId, input);
            if (line) manning.push(line);
          }
        }
        await courier.send(
          { platoon: subunitId },
          assignedText({ type: input.type, men: theirs.map((m) => ({ ...m, away: aways.get(m.personId)! })), range: input, at: target?.name ?? null, by, manning }),
        );
      }
      return { ids, label: ASSIGNMENT_LABEL[input.type] };
    },
  });
}

export type { AssignmentView };
