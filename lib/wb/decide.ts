import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { InlineKeyboardMarkup } from "grammy/types";
import { db } from "@/lib/db";
import { wbAudit } from "@/lib/wb/audit";
import { wbCard, wbCommanderChat, wbMember, wbRecord, type WbRecordKind } from "@/lib/wb/db/schema";
import { STATE_LABEL } from "@/lib/wb/domain/describe";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { canDecide, initialState, isLive, isOutcome, kinOf, leaveChange, nextState, undoRefusal, type RecordAction } from "@/lib/wb/domain/rules";
import { memberLabel, recordView, recordViews, type Db, type RecordView } from "@/lib/wb/records";
import { cardKeyboard, cardText, noticeText, outcomeCardText, outcomeKeyboard } from "@/lib/wb/telegram/cards";
import { miniAppLink } from "@/lib/wb/telegram/links";
import type { Outbound } from "@/lib/wb/telegram/outbound";

// The decision core, shared by the bot's card buttons and the Mini App. Every
// change happens in one transaction with its audit row; Telegram is told
// afterwards, and a Telegram failure never undoes a decision.

export type Via = "BOT" | "MINIAPP";

/** Who is acting: a member, their roster person (if linked) and their grants. */
export interface Actor {
  id: string;
  personId: string | null;
  grants: readonly GrantRow[];
}

export type Result = { ok: true; record: RecordView } | { ok: false; error: string; record?: RecordView };

/** Thrown inside a transaction to roll it back with a message for the user. */
export class Refusal extends Error {}

const NOTE_MAX = 300;

// ------------------------------------------------------------------ Telegram

const isNotModified = (e: unknown) => String((e as Error)?.message ?? e).includes("message is not modified");

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

/** An outcome reads MC/HL first, then its statuses by start. */
export const outcomeOrder = <R extends { kind: string; startAt: Date; detail: string }>(rows: R[]): R[] =>
  rows.sort(
    (a, b) =>
      (a.kind === "STATUS" ? 1 : 0) - (b.kind === "STATUS" ? 1 : 0) ||
      a.startAt.getTime() - b.startAt.getTime() ||
      // same day: by name, so a card reads the same every time it's redrawn
      a.detail.localeCompare(b.detail),
  );

/** Edit every copy of a record's card to its current state. An outcome's card shows the whole outcome. */
export async function refreshCards(out: Outbound | null, r: RecordView): Promise<void> {
  if (!out) return;
  const batch = isOutcome(r.kind) ? await outcomeBatch(r) : [r];
  const cards = await db.select().from(wbCard).where(inArray(wbCard.recordId, batch.map((x) => x.id)));
  for (const c of cards) {
    const text = isOutcome(r.kind) ? outcomeCardText(batch) : cardText(r);
    const reply_markup = isOutcome(r.kind) ? outcomeKeyboard(batch, out.botUsername) : cardKeyboard(r, out.botUsername);
    try {
      await out.api.editMessageText(c.chatId, c.messageId, text, { reply_markup });
    } catch (e) {
      if (!isNotModified(e)) console.error("wb card edit:", e);
    }
  }
}

/** A DM to the trooper. If he's blocked the bot, it's logged and life goes on. */
export async function tell(out: Outbound | null, r: { ownerTelegramId: number | null }, text: string, reply_markup?: InlineKeyboardMarkup): Promise<boolean> {
  if (!out || !r.ownerTelegramId) return false;
  try {
    await out.api.sendMessage(r.ownerTelegramId, text, reply_markup ? { reply_markup } : undefined);
    return true;
  } catch (e) {
    console.error("wb dm:", e);
    return false;
  }
}

/** A button straight to a record's outcome form. */
export const outcomeButton = (out: Outbound, recordId: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: "💊 Update outcome", url: miniAppLink(out.botUsername, `records/${recordId}/outcome`) }]],
});

export type Delivery = "sent" | "no-chat" | "failed";

/** Post a record's card in its platoon's commanders chat (topic, if set) and remember it. */
export async function sendCard(out: Outbound | null, r: RecordView): Promise<Delivery> {
  const [chat] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, r.subunitId));
  if (!chat) return "no-chat";
  if (!out) return "failed";
  try {
    const msg = await out.api.sendMessage(chat.chatId, cardText(r), {
      message_thread_id: chat.threadId ?? undefined,
      reply_markup: cardKeyboard(r, out.botUsername),
    });
    await db.insert(wbCard).values({ recordId: r.id, chatId: chat.chatId, threadId: chat.threadId, messageId: msg.message_id });
    return "sent";
  } catch (e) {
    console.error("wb card send:", e);
    return "failed";
  }
}

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
    throw new Refusal(`${who} has only ${left} day${left === 1 ? "" : "s"} of leave left, and this needs ${-delta}.`);
  }
  await tx.update(wbMember).set({ leaveLeft: left + delta }).where(eq(wbMember.id, m.id));
}

export async function inTx<T>(fn: (tx: Db) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await db.transaction(fn) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}

const decideRefusal = (r: RecordView) => `Only ${r.subunitName}'s PC or PS can decide this.`;

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
 * entries are DMed to each man instead.
 */
export async function submit(out: Outbound | null, actor: Actor, recs: NewRecord[], via: Via): Promise<{ records: RecordView[]; delivery: Delivery | null }> {
  const ids = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(wbRecord)
      .values(recs.map((r) => ({ ...r, state: initialState(r.kind), createdBy: actor.id })))
      .returning({ id: wbRecord.id, kind: wbRecord.kind, state: wbRecord.state, personId: wbRecord.personId });
    for (const row of rows) {
      await wbAudit(tx, { memberId: actor.id, via, action: "submit", entity: "wb_record", entityId: row.id, after: { kind: row.kind, state: row.state, personId: row.personId } });
    }
    return rows.map((r) => r.id);
  });
  const records = (await Promise.all(ids.map((id) => recordView(id)))).filter((r): r is RecordView => !!r);

  if (recs.every((r) => r.createdVia === "PROXY")) {
    const by = await memberLabel(actor.id);
    for (const r of records) await tell(out, r, noticeText(r, { kind: "added", by }));
    return { records, delivery: null };
  }
  let delivery: Delivery | null = null;
  for (const r of records) delivery = await sendCard(out, r);
  return { records, delivery };
}

// ------------------------------------------------------------------ decide

/**
 * Approve or reject, once. The UPDATE only matches a PENDING row, so of two
 * commanders tapping at once exactly one wins; the other is told who did.
 * Approving spends the leave in the same transaction.
 */
export async function decide(out: Outbound | null, actor: Actor, recordId: string, action: "approve" | "reject", via: Via, note?: string): Promise<Result> {
  const before = await recordView(recordId);
  if (!before) return { ok: false, error: "That record has gone." };
  if (!canDecide(actor.grants, before)) return { ok: false, error: decideRefusal(before), record: before };
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
  await refreshCards(out, after);
  if (!res.value) {
    return { ok: false, error: `Already ${STATE_LABEL[after.state]}${after.deciderLabel ? ` by ${after.deciderLabel}` : ""}.`, record: after };
  }
  const sickApproved = (after.kind === "RSI" || after.kind === "RSO") && after.state === "APPROVED";
  await tell(out, after, noticeText(after, { kind: "decided" }), sickApproved && out ? outcomeButton(out, after.id) : undefined);
  return { ok: true, record: after };
}

/** Take a decision back: only the decider, within ten minutes. Approved leave is refunded. */
export async function undo(out: Outbound | null, actor: Actor, recordId: string, via: Via): Promise<Result> {
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
  await refreshCards(out, after);
  await tell(out, after, noticeText(after, { kind: "undone", by: res.value }));
  return { ok: true, record: after };
}

/** The trooper pulls his own request back while it's still pending. */
export async function withdraw(out: Outbound | null, actor: Actor, recordId: string, via: Via): Promise<Result> {
  const res = await inTx(async (tx) => {
    const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
    if (!row || !actor.personId || row.personId !== actor.personId) throw new Refusal("That isn't yours to withdraw.");
    if (!nextState(row.state, "withdraw")) throw new Refusal("Only a request still waiting on a decision can be withdrawn.");
    await tx.update(wbRecord).set({ state: "WITHDRAWN", updatedAt: new Date() }).where(eq(wbRecord.id, recordId));
    await wbAudit(tx, { memberId: actor.id, via, action: "withdraw", entity: "wb_record", entityId: row.id, before: { state: row.state }, after: { state: "WITHDRAWN" } });
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = (await recordView(recordId))!;
  await refreshCards(out, after);
  return { ok: true, record: after };
}

/**
 * A commander takes an approved or recorded entry off the timeline, with
 * whatever it produced (an RSO and its MC are one afternoon). Cancelled, never
 * deleted; whoever approved it stays on the row, and the voider and why go in
 * the note and the audit. Approved leave is refunded.
 */
export async function voidRecord(out: Outbound | null, actor: Actor, recordId: string, reason: string, via: Via): Promise<Result> {
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
  await refreshCards(out, after);
  for (const k of await recordViews(res.value.also)) await refreshCards(out, k);
  await tell(out, after, noticeText(after, { kind: "voided", by, reason: why, refunded: res.value.delta }));
  return { ok: true, record: after };
}

/** "Say why" after a rejection: the decider's reason goes on the record, the card, and to the trooper. */
export async function sayWhy(out: Outbound | null, actor: Actor, recordId: string, note: string, via: Via): Promise<Result> {
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
  await refreshCards(out, after);
  await tell(out, after, noticeText(after, { kind: "why", by: after.deciderLabel ?? "your commander" }));
  return { ok: true, record: after };
}

export type { RecordAction };
