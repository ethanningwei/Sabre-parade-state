import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { Refusal, type Delivery } from "@/lib/wb/core";
import { wbMember, wbRecord, type WbRecordKind } from "@/lib/wb/db/schema";
import { decideRefusalText, manAccess, needsNoApproval, recordAccess } from "@/lib/wb/domain/access";
import { STATE_LABEL } from "@/lib/wb/domain/describe";
import {
  initialState,
  isLive,
  kinOf,
  leaveChange,
  needsApproval,
  nextState,
  NO_APPROVAL_NOTE,
  undoRefusal,
  type RecordAction,
} from "@/lib/wb/domain/rules";
import { memberLabel, personWhere, recordView, recordViews, type Db, type RecordView } from "@/lib/wb/records";
import { noticeText, outcomeButton } from "@/lib/wb/telegram/cards";
import type { Courier } from "@/lib/wb/telegram/courier";
import { write, type Acting, type Outcome } from "@/lib/wb/write";

// The decision core, shared by the bot's card buttons and the Mini App. Each
// is one Write (lib/wb/write.ts): checked and changed in one transaction with
// its audit row; Telegram is told afterwards, and a Telegram failure never
// undoes a decision.

export type Result = Outcome<RecordView>;

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
  await tx
    .update(wbMember)
    .set({ leaveLeft: left + delta })
    .where(eq(wbMember.id, m.id));
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
export async function submit(courier: Courier, by: Acting, recs: NewRecord[]): Promise<Outcome<{ records: RecordView[]; delivery: Delivery | null }>> {
  const { actor } = by;
  const now = new Date();
  return write(courier, by, {
    parade: true,
    async change({ tx, audit }) {
      for (const r of recs) {
        if (r.createdVia === "SELF") {
          if (r.personId !== actor.personId) throw new Refusal("That isn't yours.");
          continue;
        }
        const p = await personWhere(r.personId, tx);
        if (!p) throw new Refusal("Someone on that list has left the roster.");
        if (!manAccess(actor, p).proxies) throw new Refusal(`${p.rank} ${p.name} isn't in your scope.`);
      }
      const values = recs.map((r) => {
        const onSave = r.createdVia === "SELF" && needsApproval(r.kind) && needsNoApproval(actor);
        return onSave
          ? {
              ...r,
              state: "APPROVED" as const,
              decidedBy: actor.id,
              decidedAt: now,
              decisionNote: NO_APPROVAL_NOTE,
              createdBy: actor.id,
            }
          : { ...r, state: initialState(r.kind), createdBy: actor.id };
      });
      const rows = await tx.insert(wbRecord).values(values).returning({
        id: wbRecord.id,
        kind: wbRecord.kind,
        state: wbRecord.state,
        personId: wbRecord.personId,
        leaveDays: wbRecord.leaveDays,
      });
      for (const row of rows) {
        const onSave = row.state === "APPROVED";
        const delta = onSave ? leaveChange(row.kind, "PENDING", "approve", row.leaveDays) : 0;
        if (delta) await moveLeave(tx, row.personId, delta, "You");
        await audit({
          action: "submit",
          entity: "wb_record",
          entityId: row.id,
          after: {
            kind: row.kind,
            state: row.state,
            personId: row.personId,
            noApproval: onSave || undefined,
            leave: delta || undefined,
          },
        });
      }
      return rows.map((r) => r.id);
    },
    async tell(ids, c) {
      const records = (await Promise.all(ids.map((id) => recordView(id)))).filter((r): r is RecordView => !!r);
      if (recs.every((r) => r.createdVia === "PROXY")) {
        const by = await memberLabel(actor.id);
        for (const r of records) await c.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "added", by }));
        return { records, delivery: null };
      }
      let delivery: Delivery | null = null;
      for (const r of records) {
        delivery = (await c.postCard({ record: r })).delivery;
        // a report sick approved on save: straight to "Go now" with the outcome button
        if ((r.kind === "RSI" || r.kind === "RSO") && r.state === "APPROVED") {
          await c.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "decided" }), outcomeButton(r.id));
        }
      }
      return { records, delivery };
    },
  });
}

// ------------------------------------------------------------------ decide

/**
 * Approve or reject, once. The UPDATE only matches a PENDING row, so of two
 * commanders tapping at once exactly one wins; the other is told who did, and
 * his card is redrawn (the race is a write that changed nothing). Approving
 * spends the leave in the same transaction.
 */
export async function decide(courier: Courier, by: Acting, recordId: string, action: "approve" | "reject", note?: string): Promise<Result> {
  const { actor } = by;
  const to = nextState("PENDING", action)!;
  const why = note?.trim().slice(0, NOTE_MAX) || null;

  const res = await write(courier, by, {
    parade: true,
    async change({ tx, audit }) {
      const before = await recordView(recordId, tx);
      if (!before) throw new Refusal("That record has gone.");
      if (!recordAccess(actor, before).approves) throw new Refusal(decideRefusalText(actor, before));
      const [row] = await tx
        .update(wbRecord)
        .set({
          state: to,
          decidedBy: actor.id,
          decidedAt: new Date(),
          decisionNote: why,
          updatedAt: new Date(),
        })
        .where(and(eq(wbRecord.id, recordId), eq(wbRecord.state, "PENDING")))
        .returning();
      if (!row) return false;
      const delta = leaveChange(row.kind, "PENDING", action, row.leaveDays);
      if (delta) await moveLeave(tx, row.personId, delta, `${before.rank} ${before.name}`);
      await audit({
        action,
        entity: "wb_record",
        entityId: row.id,
        before: { state: "PENDING" },
        after: { state: to, note: why, leave: delta || undefined },
      });
      return true;
    },
    async tell(won, c) {
      const after = (await recordView(recordId))!;
      await c.redraw({ record: after });
      if (won) {
        const sickApproved = (after.kind === "RSI" || after.kind === "RSO") && after.state === "APPROVED";
        await c.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "decided" }), sickApproved ? outcomeButton(after.id) : undefined);
      }
      return { won, after };
    },
  });
  if (!res.ok) return res;
  const { won, after } = res.value;
  if (!won)
    return {
      ok: false,
      error: `Already ${STATE_LABEL[after.state]}${after.deciderLabel ? ` by ${after.deciderLabel}` : ""}.`,
    };
  return { ok: true, value: after };
}

/** Take a decision back: only the decider, within ten minutes. Approved leave is refunded. */
export async function undo(courier: Courier, by: Acting, recordId: string): Promise<Result> {
  return write(courier, by, {
    parade: true,
    async change({ tx, audit }) {
      const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
      if (!row) throw new Refusal("That record has gone.");
      const label = row.decidedBy ? await memberLabel(row.decidedBy, tx) : "whoever decided it";
      const refusal = undoRefusal(row, by.actor.id, label);
      if (refusal) throw new Refusal(refusal);
      const view = (await recordView(recordId, tx))!;
      // the decider must still command there, as the Mini App's Undo button asks
      if (!recordAccess(by.actor, view).commands) throw new Refusal(`You're no longer ${view.subunitName}'s PC or PS, so you can't take that back.`);
      const outcome = await tx.select({ id: wbRecord.id, state: wbRecord.state }).from(wbRecord).where(eq(wbRecord.parentId, recordId));
      if (outcome.some((o) => isLive(o.state))) throw new Refusal("He's already recorded what the doctor gave him. Void it instead.");
      await tx
        .update(wbRecord)
        .set({
          state: "PENDING",
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          updatedAt: new Date(),
        })
        .where(eq(wbRecord.id, recordId));
      const delta = leaveChange(row.kind, row.state, "undo", row.leaveDays);
      if (delta) await moveLeave(tx, row.personId, delta, `${view.rank} ${view.name}`);
      await audit({
        action: "undo",
        entity: "wb_record",
        entityId: row.id,
        before: { state: row.state },
        after: { state: "PENDING", leave: delta || undefined },
      });
      return label;
    },
    async tell(label, c) {
      const after = (await recordView(recordId))!;
      await c.redraw({ record: after });
      await c.send({ telegramId: after.ownerTelegramId }, noticeText(after, { kind: "undone", by: label }));
      return after;
    },
  });
}

/** The trooper pulls his own request back while it's still pending. Pending is never on the parade state. */
export async function withdraw(courier: Courier, by: Acting, recordId: string): Promise<Result> {
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
      if (!row || !by.actor.personId || row.personId !== by.actor.personId) throw new Refusal("That isn't yours to withdraw.");
      if (!nextState(row.state, "withdraw")) throw new Refusal("Only a request still waiting on a decision can be withdrawn.");
      await tx.update(wbRecord).set({ state: "WITHDRAWN", updatedAt: new Date() }).where(eq(wbRecord.id, recordId));
      await audit({
        action: "withdraw",
        entity: "wb_record",
        entityId: row.id,
        before: { state: row.state },
        after: { state: "WITHDRAWN" },
      });
    },
    async tell(_, c) {
      const after = (await recordView(recordId))!;
      await c.redraw({ record: after });
      return after;
    },
  });
}

/**
 * A commander takes an approved or recorded entry off the timeline, with
 * whatever it produced (an RSO and its MC are one afternoon). Cancelled, never
 * deleted; whoever approved it stays on the row, and the voider and why go in
 * the note and the audit. Approved leave is refunded.
 */
export async function voidRecord(courier: Courier, by: Acting, recordId: string, reason: string): Promise<Result> {
  const why = reason.trim().slice(0, NOTE_MAX);
  return write(courier, by, {
    parade: true,
    async change({ tx, audit }) {
      const before = await recordView(recordId, tx);
      if (!before) throw new Refusal("That record has gone.");
      if (!recordAccess(by.actor, before).commands) throw new Refusal(`Only ${before.subunitName}'s PC or PS can void this.`);
      if (why.length < 3) throw new Refusal("Say why you're voiding it.");
      const voider = await memberLabel(by.actor.id, tx);
      const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
      if (!row || !nextState(row.state, "void")) throw new Refusal("Only an approved or recorded entry can be voided.");
      const children = await tx
        .select({
          id: wbRecord.id,
          parentId: wbRecord.parentId,
          state: wbRecord.state,
        })
        .from(wbRecord)
        .where(eq(wbRecord.parentId, recordId));
      const kin = kinOf({ id: row.id, parentId: row.parentId, state: row.state }, children);
      await tx
        .update(wbRecord)
        .set({
          state: "CANCELLED",
          decisionNote: `Voided by ${voider}: ${why}`,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            wbRecord.id,
            kin.map((k) => k.id),
          ),
        );
      const delta = leaveChange(row.kind, row.state, "void", row.leaveDays);
      if (delta) await moveLeave(tx, row.personId, delta, `${before.rank} ${before.name}`);
      await audit({
        action: "void",
        entity: "wb_record",
        entityId: row.id,
        before: { state: row.state },
        after: {
          state: "CANCELLED",
          note: why,
          leave: delta || undefined,
          alsoVoided: kin.length > 1 ? kin.slice(1).map((k) => k.id) : undefined,
        },
      });
      return { voider, delta, also: kin.slice(1).map((k) => k.id) };
    },
    async tell({ voider, delta, also }, c) {
      const after = (await recordView(recordId))!;
      await c.redraw({ record: after });
      for (const k of await recordViews(also)) await c.redraw({ record: k });
      await c.send(
        { telegramId: after.ownerTelegramId },
        noticeText(after, {
          kind: "voided",
          by: voider,
          reason: why,
          refunded: delta,
        }),
      );
      return after;
    },
  });
}

/** "Say why" after a rejection: the decider's reason goes on the record, the card, and to the trooper. */
export async function sayWhy(courier: Courier, by: Acting, recordId: string, note: string): Promise<Result> {
  const why = note.trim().slice(0, NOTE_MAX);
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!why) throw new Refusal("Type a reason.");
      const [row] = await tx.select().from(wbRecord).where(eq(wbRecord.id, recordId)).for("update");
      if (!row) throw new Refusal("That record has gone.");
      if (row.state !== "REJECTED" || row.decidedBy !== by.actor.id) throw new Refusal("Only whoever rejected it can say why.");
      if (row.decisionNote) throw new Refusal("You've already said why.");
      await tx.update(wbRecord).set({ decisionNote: why, updatedAt: new Date() }).where(eq(wbRecord.id, recordId));
      await audit({
        action: "say-why",
        entity: "wb_record",
        entityId: row.id,
        before: { note: row.decisionNote },
        after: { note: why },
      });
    },
    async tell(_, c) {
      const after = (await recordView(recordId))!;
      await c.redraw({ record: after });
      await c.send(
        { telegramId: after.ownerTelegramId },
        noticeText(after, {
          kind: "why",
          by: after.deciderLabel ?? "your commander",
        }),
      );
      return after;
    },
  });
}

export type { RecordAction };
