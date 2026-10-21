import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp } from "@/lib/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { inTx, Refusal, type Actor, type Via } from "@/lib/wb/core";
import { wbAssignment, wbRfRequest } from "@/lib/wb/db/schema";
import { assignmentAccess, campAccess, manAccess, rfAccess } from "@/lib/wb/domain/access";
import {
  ASSIGNMENT_LABEL,
  assignedText,
  assignRefusal,
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

// RF requests and Extra/RF/SOL: the writes. Each change is one transaction
// with its audit row; Telegram is told afterwards, and a Telegram failure
// never undoes anything. Nothing here writes v1 duty or absence: an
// assignment is counted by the forecast only, until projection (Phase 6).

const lockPerson = (tx: Db, personId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wb-assign:${personId}`}))`);

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
export async function raiseRf(courier: Courier, actor: Actor, input: NewRequest, via: Via) {
  const [c] = await db.select({ id: camp.id, subunitId: camp.subunitId, name: camp.name }).from(camp).where(eq(camp.id, input.campId));
  if (!c) return { ok: false as const, error: "That camp no longer exists." };
  if (!campAccess(actor, { subunitId: c.subunitId, campId: c.id }).asks) return { ok: false as const, error: `You can't ask for manpower for ${c.name}.` };
  const res = await inTx(async (tx) => {
    const [row] = await tx
      .insert(wbRfRequest)
      .values({ campId: c.id, role: input.role, need: input.need, startAt: input.startAt, endAt: input.endAt, reason: input.reason, raisedBy: actor.id })
      .returning();
    await wbAudit(tx, { memberId: actor.id, via, action: "raise-rf", entity: "wb_rf_request", entityId: row.id, after: { campId: c.id, role: row.role, need: row.need, startAt: row.startAt, endAt: row.endAt, reason: row.reason } });
    return row.id;
  });
  if (!res.ok) return res;
  const r = (await rfView(res.value))!;

  const { delivery, chats } = await courier.postCard({ rf: r });
  return { ok: true as const, value: { request: r, delivery, chats } };
}

// ------------------------------------------------------------------ deploy

/**
 * Send a man to a request. Claimed under a lock on the request, with the
 * count checked inside it, so two commanders tapping Deploy on the last slot
 * can't both send a man: the second is told somebody got there first. A
 * commander deploying is the approval. Being down as away is a warning, never
 * a veto.
 */
export async function deploy(courier: Courier, actor: Actor, requestId: string, personId: string, via: Via) {
  const man = await personWhere(personId);
  if (!man) return { ok: false as const, error: "That man is no longer on the roster." };
  if (!manAccess(actor, man).sends) return { ok: false as const, error: `You can't send ${man.rank} ${man.name}: he isn't in your platoon or camp.` };
  const before = await rfView(requestId);
  if (!before) return { ok: false as const, error: "That request has gone." };
  const away = await clashFor(personId, before);

  const res = await inTx(async (tx) => {
    await tx.select({ id: wbRfRequest.id }).from(wbRfRequest).where(eq(wbRfRequest.id, requestId)).for("update");
    await lockPerson(tx, personId);
    const r = (await rfView(requestId, tx))!;
    const refusal = deployRefusal(r, man, await liveAssignments(r, [personId], tx));
    if (refusal) throw new Refusal(refusal);
    const [a] = await tx
      .insert(wbAssignment)
      .values({ personId, type: "RF", campId: r.campId, startAt: r.startAt, endAt: r.endAt!, rfRequestId: r.id, createdBy: actor.id })
      .returning({ id: wbAssignment.id });
    const state = stateAfter(r.state, r.need, r.deployed.length + 1);
    if (state !== r.state) await tx.update(wbRfRequest).set({ state }).where(eq(wbRfRequest.id, r.id));
    await wbAudit(tx, { memberId: actor.id, via, action: "deploy", entity: "wb_assignment", entityId: a.id, after: { rfRequestId: r.id, personId, campId: r.campId, state } });
    return a.id;
  });
  await courier.redraw({ rf: requestId });
  if (!res.ok) return res;

  const r = (await rfView(requestId))!;
  const by = await memberLabel(actor.id);
  // the man that he's going, his own commanders that they're a head down, and whoever asked that it's answered
  await courier.send({ person: personId }, sentNotice({ type: "RF", range: r, at: r.campName, home: man.campName, by, viaRequest: true, away }));
  await courier.send({ platoon: man.subunitId }, headDownText({ type: "RF", man, range: r, at: r.campName, by, viaRequest: true, away, manning: await campManningLine(man.campId, r) }));
  if (r.raisedById !== actor.id) await courier.send({ telegramId: r.raisedByTelegramId }, `✅ ${r.campName} is getting ${deployedLabel(man)}\n\n${rfStateLine(r)}`);
  return { ok: true as const, value: { request: r, assignmentId: res.value, away } };
}

// ------------------------------------------------------------------ close

/** No longer needed. The raiser, or anyone who could raise one for that camp. Men already sent stay sent. */
export async function closeRf(courier: Courier, actor: Actor, requestId: string, via: Via) {
  const before = await rfView(requestId);
  if (!before) return { ok: false as const, error: "That request has gone." };
  if (!rfAccess(actor, before).asks) return { ok: false as const, error: `Only whoever asked, or ${before.campName}'s commanders, can close this.` };
  const res = await inTx(async (tx) => {
    const [row] = await tx
      .update(wbRfRequest)
      .set({ state: "CLOSED", closedBy: actor.id, closedAt: new Date() })
      .where(and(eq(wbRfRequest.id, requestId), eq(wbRfRequest.state, "OPEN")))
      .returning({ id: wbRfRequest.id });
    if (!row) {
      throw new Refusal(
        before.state === "FILLED" ? "It's already filled. Stand the men down from the request first." : before.state === "EXPIRED" ? "Its shift has passed: it's expired." : "It's already closed.",
      );
    }
    await wbAudit(tx, { memberId: actor.id, via, action: "close-rf", entity: "wb_rf_request", entityId: requestId, before: { state: "OPEN" }, after: { state: "CLOSED" } });
  });
  await courier.redraw({ rf: requestId });
  if (!res.ok) return res;
  return { ok: true as const, value: (await rfView(requestId))! };
}

/**
 * The evening round: a request whose shift passed while still OPEN is
 * EXPIRED, and every copy of its card says so (the user, 2026-10-14: that
 * edited card is the notice). Men already sent stay as they are.
 */
export async function expireRfRequests(courier: Courier, now: Date = new Date()): Promise<number> {
  const expired = await db.transaction(async (tx) => {
    const rows = await tx
      .update(wbRfRequest)
      .set({ state: "EXPIRED", closedAt: now })
      .where(and(eq(wbRfRequest.state, "OPEN"), lte(wbRfRequest.endAt, now)))
      .returning({ id: wbRfRequest.id });
    for (const r of rows) {
      await wbAudit(tx, { memberId: null, via: "SYSTEM", action: "expire-rf", entity: "wb_rf_request", entityId: r.id, before: { state: "OPEN" }, after: { state: "EXPIRED" } });
    }
    return rows.map((r) => r.id);
  });
  for (const id of expired) await courier.redraw({ rf: id });
  return expired.length;
}

// ------------------------------------------------------------------ stand down

/**
 * Cancel an Extra/RF/SOL: he's back with his own camp. Whoever may send him,
 * whoever put him on it, or (for a request) the camp that asked. A request it
 * filled opens again.
 */
export async function standDown(courier: Courier, actor: Actor, assignmentId: string, via: Via) {
  const a = await assignmentView(assignmentId);
  if (!a) return { ok: false as const, error: "That's gone." };
  const req = a.rfRequestId ? await rfView(a.rfRequestId) : null;
  if (!assignmentAccess(actor, { man: { subunitId: a.subunitId, campId: a.homeCampId }, request: req }).standDown) return { ok: false as const, error: `You can't stand ${a.rank} ${a.name} down.` };
  const res = await inTx(async (tx) => {
    if (a.rfRequestId) await tx.select({ id: wbRfRequest.id }).from(wbRfRequest).where(eq(wbRfRequest.id, a.rfRequestId)).for("update");
    const [row] = await tx
      .update(wbAssignment)
      .set({ state: "CANCELLED", cancelledBy: actor.id, cancelledAt: new Date() })
      .where(and(eq(wbAssignment.id, assignmentId), eq(wbAssignment.state, "ACTIVE")))
      .returning({ id: wbAssignment.id });
    if (!row) throw new Refusal("He's already been stood down.");
    let state: string | undefined;
    if (a.rfRequestId) {
      const r = (await rfView(a.rfRequestId, tx))!;
      const next = stateAfter(r.state, r.need, r.deployed.length);
      if (next !== r.state) await tx.update(wbRfRequest).set({ state: next }).where(eq(wbRfRequest.id, r.id));
      state = next;
    }
    await wbAudit(tx, { memberId: actor.id, via, action: "stand-down", entity: "wb_assignment", entityId: assignmentId, before: { state: "ACTIVE" }, after: { state: "CANCELLED", rfRequestId: a.rfRequestId, request: state } });
  });
  if (!res.ok) return res;
  if (a.rfRequestId) await courier.redraw({ rf: a.rfRequestId });
  const by = await memberLabel(actor.id);
  await courier.send({ person: a.personId }, standDownNotice({ type: a.type, range: a, at: a.campName, by }));
  await courier.send({ platoon: a.subunitId }, `↩️ Stood down by ${by}\n\n${a.rank} ${a.name} (${a.homeCampName})\n${a.line}\n\nBack with ${a.homeCampName}.`);
  return { ok: true as const, value: a };
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
export async function assign(courier: Courier, actor: Actor, input: NewAssignment, via: Via) {
  const men = await Promise.all(input.personIds.map((id) => personWhere(id)));
  if (men.some((m) => !m)) return { ok: false as const, error: "Someone picked is no longer on the roster." };
  const list = men as NonNullable<(typeof men)[number]>[];
  const outside = list.find((m) => !manAccess(actor, m).sends);
  if (outside) return { ok: false as const, error: `You can't send ${outside.rank} ${outside.name}: he isn't in your platoon or camp.` };
  let target: { id: string; name: string } | null = null;
  if (input.type !== "SOL") {
    if (!input.campId) return { ok: false as const, error: "Pick the camp they're serving at." };
    [target] = await db.select({ id: camp.id, name: camp.name }).from(camp).where(eq(camp.id, input.campId));
    if (!target) return { ok: false as const, error: "That camp no longer exists." };
  }
  const aways = new Map<string, string[]>();
  for (const m of list) aways.set(m.personId, await clashFor(m.personId, input));

  const res = await inTx(async (tx) => {
    for (const m of [...list].sort((x, y) => x.personId.localeCompare(y.personId))) await lockPerson(tx, m.personId);
    const busy = await liveAssignments(input, list.map((m) => m.personId), tx);
    const refusals = list.map((m) => assignRefusal(input.type, target?.id ?? null, m, input, busy)).filter((x): x is string => !!x);
    if (refusals.length) throw new Refusal(refusals.join("\n"));
    const rows = await tx
      .insert(wbAssignment)
      .values(list.map((m) => ({ personId: m.personId, type: input.type, campId: target?.id ?? m.campId, startAt: input.startAt, endAt: input.endAt, note: input.note, createdBy: actor.id })))
      .returning({ id: wbAssignment.id, personId: wbAssignment.personId, campId: wbAssignment.campId });
    for (const r of rows) await wbAudit(tx, { memberId: actor.id, via, action: "assign", entity: "wb_assignment", entityId: r.id, after: { type: input.type, personId: r.personId, campId: r.campId, startAt: input.startAt, endAt: input.endAt } });
    return rows.map((r) => r.id);
  });
  if (!res.ok) return res;

  const by = await memberLabel(actor.id);
  for (const m of list) {
    await courier.send({ person: m.personId }, sentNotice({ type: input.type, range: input, at: target?.name ?? m.campName, home: m.campName, by, viaRequest: false, away: aways.get(m.personId)! }));
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
    await courier.send({ platoon: subunitId }, assignedText({ type: input.type, men: theirs.map((m) => ({ ...m, away: aways.get(m.personId)! })), range: input, at: target?.name ?? null, by, manning }));
  }
  return { ok: true as const, value: { ids: res.value, label: ASSIGNMENT_LABEL[input.type] } };
}

export type { AssignmentView };
