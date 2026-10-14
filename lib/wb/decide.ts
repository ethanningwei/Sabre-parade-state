import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { wbAudit } from "@/lib/wb/audit";
import { inTx, Refusal, type Actor, type Delivery, type Via } from "@/lib/wb/core";
import { wbMember, wbRecord, type WbRecordKind } from "@/lib/wb/db/schema";
import { STATE_LABEL } from "@/lib/wb/domain/describe";
import {
  canDecide,
  canDecideRequest,
  decideRefusalText,
  initialState,
  isLive,
  kinOf,
  leaveChange,
  needsApproval,
  needsNoApproval,
  nextState,
  NO_APPROVAL_NOTE,
  undoRefusal,
  type RecordAction,
} from "@/lib/wb/domain/rules";
import { memberLabel, recordView, recordViews, type Db, type RecordView } from "@/lib/wb/records";
import { noticeText, outcomeButton } from "@/lib/wb/telegram/cards";
import type { Courier } from "@/lib/wb/telegram/courier";

// The decision core, shared by the bot's card buttons and the Mini App. Every
// change happens in one transaction with its audit row; Telegram is told
// afterwards, and a Telegram failure never undoes a decision.

export type Result = { ok: true; record: RecordView } | { ok: false; error: string; record?: RecordView };

const NOTE_MAX = 300;

// ------------------------------------------------------------------ helpers

/** Move a trooper's balance. Refuses to take it below zero. No account linked: nothing to move. */
async function moveLeave(tx: Db, personId: string, delta: number, who: string): Promise<void> {
  const [m] = await tx
    .select({ id: wbMember.id, leaveLeft: wbMember.leaveLeft })
    .from(wbMember)
    .where(and(eq(wbMember.personId, personId), eq(wbMember.active, true)))
    .for("update");
  if (!m) return;
  const left = m.leaveLeft ?? 0;
  if (left + delta < 0) {
    throw new Refusal(`${who} ${who === "You" ? "have" : "has"} only ${left} day${left === 1 ? "" : "s"} of leave left, and this needs ${-delta}.`);
  }
  await tx.update(wbMember).set({ leaveLeft: left + delta }).where(eq(wbMember.id, m.id));
}

// ------------------------------------------------------------------ submit

export interface NewRecord {
  personId: string;
  /** the trooper's own account; null when a commander adds it for him */
  memberId: string | null;
  kind: WbRecordKind;
  startAt: Date;
  endAt: Date;
  absent: boolean;
  leaveDays?: number | null;
  detail?: string;
  location?: string;
  reason?: string;
  maTiming?: string | null;
  createdVia: "SELF" | "PROXY";
}

/**
 * Save new records (PENDING for leave and off, RECORDED otherwise), then put
 * the card in front of the commanders. A trooper's own entry gets a card even
 * when it needs no approval, so his PC knows about the MA; a commander's proxy
 * entries are DMed to each man instead. OC, 2IC and CSM need no approval:
 * their own requests are saved approved, and leave is spent there and then.
 */
export async function submit(courier: Courier, actor: Actor, recs: NewRecord[], via: Via): Promise<{ records: RecordView[]; delivery: Delivery | null }> {
  const now = new Date();
  const ids = await db.transaction(async (tx) => {
    const values = recs.map((r) => {
      const onSave = r.createdVia === "SELF" && needsApproval(r.kind) && needsNoApproval(actor.grants);
      return onSave
        ? { ...r, state: "APPROVED" as const, decidedBy: actor.id, decidedAt: now, decisionNote: NO_APPROVAL_NOTE, createdBy: actor.id }
        : { ...r, state: initialState(r.kind), createdBy: actor.id };
    });
    const rows = await tx
      .insert(wbRecord)
      .values(values)
      .returning({ id: wbRecord.id, kind: wbRecord.kind, state: wbRecord.state, personId: wbRecord.personId, leaveDays: wbRecord.leaveDays });
    for (const row of rows) {
      const onSave = row.state === "APPROVED";
      const delta = onSave ? leaveChange(row.kind, "PENDING", "approve", row.leaveDays) : 0;
      if (delta) await moveLeave(tx, row.personId, delta, "You");
      await wbAudit(tx, {
        memberId: actor.id,
        via,
        action: "submit",
        entity: "wb_record",
        entityId: row.id,
        after: { kind: row.kind, state: row.state, personId: row.personId, noApproval: onSave || undefined, leave: delta || undefined },
      });
    }
    return rows.map((r) => r.id);
  });
  const records = (await Promise.all(ids.map((id) => recordView(id)))).filter((r): r is RecordView => !!r);

  if (recs.every((r) => r.createdVia === "PROXY")) {
    const by = await memberLabel(actor.id);
    for (const r of records) await courier.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "added", by }));
    return { records, delivery: null };
  }
  let delivery: Delivery | null = null;
  for (const r of records) {
    delivery = (await courier.postCard({ record: r })).delivery;
    // a report sick approved on save: straight to "Go now" with the outcome button
    if ((r.kind === "RSI" || r.kind === "RSO") && r.state === "APPROVED") {
      await courier.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "decided" }), outcomeButton(r.id));
    }
  }
  return { records, delivery };
}

// ------------------------------------------------------------------ decide

/**
 * Approve or reject, once. The UPDATE only matches a PENDING row, so of two
 * commanders tapping at once exactly one wins; the other is told who did.
 * Approving spends the leave in the same transaction.
 */
export async function decide(courier: Courier, actor: Actor, recordId: string, action: "approve" | "reject", via: Via, note?: string): Promise<Result> {
  const before = await recordView(recordId);
  if (!before) return { ok: false, error: "That record has gone." };
  if (!canDecideRequest(actor, before)) return { ok: false, error: decideRefusalText(actor, before), record: before };
  const to = nextState("PENDING", action)!;
  const why = note?.trim().slice(0, NOTE_MAX) || null;

  const res = await inTx(async (tx) => {
    const [row] = await tx
      .update(wbRecord)
      .set({ state: to, decidedBy: actor.id, decidedAt: new Date(), decisionNote: why, updatedAt: new Date() })
      .where(and(eq(wbRecord.id, recordId), eq(wbRecord.state, "PENDING")))
      .returning();
    if (!row) return false;
    const delta = leaveChange(row.kind, "PENDING", action, row.leaveDays);
    if (delta) await moveLeave(tx, row.personId, delta, `${before.rank} ${before.name}`);
    await wbAudit(tx, { memberId: actor.id, via, action, entity: "wb_record", entityId: row.id, before: { state: "PENDING" }, after: { state: to, note: why, leave: delta || undefined } });
    return true;
  });
  if (!res.ok) return { ok: false, error: res.error, record: before };

  const after = (await recordView(recordId))!;
  await courier.redraw({ record: after });
  if (!res.value) {
    return { ok: false, error: `Already ${STATE_LABEL[after.state]}${after.deciderLabel ? ` by ${after.deciderLabel}` : ""}.`, record: after };
  }
  const sickApproved = (after.kind === "RSI" || after.kind === "RSO") && after.state === "APPROVED";
  await courier.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "decided" }), sickApproved ? outcomeButton(after.id) : undefined);
  return { ok: true, record: after };
}

/** Take a decision back: only the decider, within ten minutes. Approved leave is refunded. */
export async function undo(courier: Courier, actor: Actor, recordId: string, via: Via): Promise<Result> {
  const res = await inTx(async (tx) => {
    const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
    if (!row) throw new Refusal("That record has gone.");
    const label = row.decidedBy ? await memberLabel(row.decidedBy, tx) : "whoever decided it";
    const refusal = undoRefusal(row, actor.id, label);
    if (refusal) throw new Refusal(refusal);
    const outcome = await tx.select({ id: wbRecord.id, state: wbRecord.state }).from(wbRecord).where(eq(wbRecord.parentId, recordId));
    if (outcome.some((o) => isLive(o.state))) throw new Refusal("He's already recorded what the doctor gave him. Void it instead.");
    await tx
      .update(wbRecord)
      .set({ state: "PENDING", decidedBy: null, decidedAt: null, decisionNote: null, updatedAt: new Date() })
      .where(eq(wbRecord.id, recordId));
    const delta = leaveChange(row.kind, row.state, "undo", row.leaveDays);
    const view = (await recordView(recordId, tx))!;
    if (delta) await moveLeave(tx, row.personId, delta, `${view.rank} ${view.name}`);
    await wbAudit(tx, { memberId: actor.id, via, action: "undo", entity: "wb_record", entityId: row.id, before: { state: row.state }, after: { state: "PENDING", leave: delta || undefined } });
    return label;
  });
  if (!res.ok) return { ok: false, error: res.error, record: (await recordView(recordId)) ?? undefined };
  const after = (await recordView(recordId))!;
  await courier.redraw({ record: after });
  await courier.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "undone", by: res.value }));
  return { ok: true, record: after };
}

/** The trooper pulls his own request back while it's still pending. */
export async function withdraw(courier: Courier, actor: Actor, recordId: string, via: Via): Promise<Result> {
  const res = await inTx(async (tx) => {
    const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
    if (!row || !actor.personId || row.personId !== actor.personId) throw new Refusal("That isn't yours to withdraw.");
    if (!nextState(row.state, "withdraw")) throw new Refusal("Only a request still waiting on a decision can be withdrawn.");
    await tx.update(wbRecord).set({ state: "WITHDRAWN", updatedAt: new Date() }).where(eq(wbRecord.id, recordId));
    await wbAudit(tx, { memberId: actor.id, via, action: "withdraw", entity: "wb_record", entityId: row.id, before: { state: row.state }, after: { state: "WITHDRAWN" } });
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = (await recordView(recordId))!;
  await courier.redraw({ record: after });
  return { ok: true, record: after };
}

/**
 * A commander takes an approved or recorded entry off the timeline, with
 * whatever it produced (an RSO and its MC are one afternoon). Cancelled, never
 * deleted; whoever approved it stays on the row, and the voider and why go in
 * the note and the audit. Approved leave is refunded.
 */
export async function voidRecord(courier: Courier, actor: Actor, recordId: string, reason: string, via: Via): Promise<Result> {
  const before = await recordView(recordId);
  if (!before) return { ok: false, error: "That record has gone." };
  if (!canDecide(actor.grants, before)) return { ok: false, error: `Only ${before.subunitName}'s PC or PS can void this.`, record: before };
  const why = reason.trim().slice(0, NOTE_MAX);
  if (why.length < 3) return { ok: false, error: "Say why you're voiding it.", record: before };
  const by = await memberLabel(actor.id);
  const note = `Voided by ${by}: ${why}`;

  const res = await inTx(async (tx) => {
    const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
    if (!row || !nextState(row.state, "void")) throw new Refusal("Only an approved or recorded entry can be voided.");
    const children = await tx.select({ id: wbRecord.id, parentId: wbRecord.parentId, state: wbRecord.state }).from(wbRecord).where(eq(wbRecord.parentId, recordId));
    const kin = kinOf({ id: row.id, parentId: row.parentId, state: row.state }, children);
    await tx
      .update(wbRecord)
      .set({ state: "CANCELLED", decisionNote: note, updatedAt: new Date() })
      .where(inArray(wbRecord.id, kin.map((k) => k.id)));
    const delta = leaveChange(row.kind, row.state, "void", row.leaveDays);
    if (delta) await moveLeave(tx, row.personId, delta, `${before.rank} ${before.name}`);
    await wbAudit(tx, {
      memberId: actor.id,
      via,
      action: "void",
      entity: "wb_record",
      entityId: row.id,
      before: { state: row.state },
      after: { state: "CANCELLED", note: why, leave: delta || undefined, alsoVoided: kin.length > 1 ? kin.slice(1).map((k) => k.id) : undefined },
    });
    return { delta, also: kin.slice(1).map((k) => k.id) };
  });
  if (!res.ok) return { ok: false, error: res.error, record: before };
  const after = (await recordView(recordId))!;
  await courier.redraw({ record: after });
  for (const k of await recordViews(res.value.also)) await courier.redraw({ record: k });
  await courier.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "voided", by, reason: why, refunded: res.value.delta }));
  return { ok: true, record: after };
}

/** "Say why" after a rejection: the decider's reason goes on the record, the card, and to the trooper. */
export async function sayWhy(courier: Courier, actor: Actor, recordId: string, note: string, via: Via): Promise<Result> {
  const why = note.trim().slice(0, NOTE_MAX);
  if (!why) return { ok: false, error: "Type a reason." };
  const res = await inTx(async (tx) => {
    const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
    if (!row) throw new Refusal("That record has gone.");
    if (row.state !== "REJECTED" || row.decidedBy !== actor.id) throw new Refusal("Only whoever rejected it can say why.");
    await tx.update(wbRecord).set({ decisionNote: why, updatedAt: new Date() }).where(eq(wbRecord.id, recordId));
    await wbAudit(tx, { memberId: actor.id, via, action: "say-why", entity: "wb_record", entityId: row.id, before: { note: row.decisionNote }, after: { note: why } });
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = (await recordView(recordId))!;
  await courier.redraw({ record: after });
  await courier.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "why", by: after.deciderLabel ?? "your commander" }));
  return { ok: true, record: after };
}

export type { RecordAction };
