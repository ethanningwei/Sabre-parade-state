import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { wbAudit } from "@/lib/wb/audit";
import { inTx, outcomeBatch, outcomeOrder, refreshCards, Refusal, tell, type Actor, type Delivery, type Via } from "@/lib/wb/decide";
import { wbCard, wbCommanderChat, wbRecord } from "@/lib/wb/db/schema";
import { recordWhat } from "@/lib/wb/domain/describe";
import { asksSeenBy, canDecide, isLive, isOutcome, kinOf, MAX_STATUSES, onensFor, outcomeParentRefusal, VISIT_KINDS, type WbSeenBy } from "@/lib/wb/domain/rules";
import { addDays, dateRange, dayCount, todaySgt } from "@/lib/wb/domain/timeline";
import { memberLabel, recordView, recordViews, type RecordView } from "@/lib/wb/records";
import { outcomeCardText, outcomeKeyboard } from "@/lib/wb/telegram/cards";
import type { Outbound } from "@/lib/wb/telegram/outbound";

// What the doctor gave him (ports Sabre Bot's _commit_outcome). One visit to
// a doctor becomes the rows it produced: an MC or HL, and any statuses on the
// same paper, all RECORDED, all carrying the one photo. They hang off the
// RSI/RSO/MA they came from; with no visit above them, the MC (or the first
// status) is the head and the rest hang off it, so a visit is still one thing.
//
// Recording again replaces: the old rows are cancelled ("Corrected by ..."),
// never edited, so both versions stay readable and the commanders are shown
// what changed. An outcome needs no commander, so this is how a wrong MC date
// gets fixed.

/** How far back an MC may start: a typo guard, not a rule. */
const BACK_DAYS = 60;
/** The longest MC/HL and the longest temporary status, in days. */
const MC_MAX_DAYS = 180;
const STATUS_MAX_DAYS = 366;

export interface McInput {
  kind: "MC" | "HL";
  category: string;
  diagnosis: string;
  startDate: string;
  endDate: string;
  /** asked only when no report sick says who wrote it */
  seenBy: WbSeenBy | null;
}

export interface StatusInput {
  label: string;
  startDate: string;
  /** null = permanent */
  endDate: string | null;
}

export interface OutcomeInput {
  /** the RSI/RSO/MA it came from, or a standalone outcome's head when correcting it; null for a new standalone one */
  anchorId: string | null;
  mc: McInput | null;
  statuses: StatusInput[];
  /** from a verified photo token; null keeps the photo already on the outcome being corrected */
  photoFileId: string | null;
  /** "Have you uploaded it to ONENS?" — only asked for a civilian MC */
  onensUploaded: boolean;
}

export interface Recorded {
  recordIds: string[];
  /** the record to open afterwards: the visit, or the new head */
  anchorId: string;
  delivery: Delivery | null;
  nothing: boolean;
}

function checkDates(what: string, start: string, end: string | null, maxDays: number, today: string): void {
  if (start < addDays(today, -BACK_DAYS)) throw new Refusal(`${what} starts more than ${BACK_DAYS} days ago. Check the year, or tell your PS.`);
  if (end === null) return;
  if (end < start) throw new Refusal(`${what} can't end before it starts.`);
  if (dayCount(dateRange(start, end)) > maxDays) throw new Refusal(`${what} is longer than ${maxDays} days. Check the dates.`);
}

/**
 * Save an outcome (or nothing given, or a correction), in one transaction.
 * Then the card goes to the commanders (no diagnosis, no photo) and the
 * trooper gets his summary.
 */
export async function saveOutcome(out: Outbound | null, actor: Actor, input: OutcomeInput, via: Via): Promise<{ ok: true; value: Recorded } | { ok: false; error: string }> {
  const personId = actor.personId;
  if (!personId) return { ok: false, error: "Ask your PS to add you to the parade state first." };
  if (input.statuses.length > MAX_STATUSES) return { ok: false, error: `${MAX_STATUSES} statuses at a time. Record the rest as a second entry.` };
  const by = await memberLabel(actor.id);
  const today = todaySgt();

  const res = await inTx(async (tx) => {
    // ---------------------------------------------------------------- what it hangs off, and what it replaces
    let parent: typeof wbRecord.$inferSelect | null = null;
    let previous: { id: string; evidenceFileId: string | null }[] = [];
    if (input.anchorId) {
      const [anchor] = await tx.select().from(wbRecord).where(eq(wbRecord.id, input.anchorId)).for("update");
      if (!anchor) throw new Refusal("That record has gone.");
      if (VISIT_KINDS.includes(anchor.kind)) {
        const refusal = outcomeParentRefusal(anchor, personId);
        if (refusal) throw new Refusal(refusal);
        parent = anchor;
        const kids = await tx.select().from(wbRecord).where(eq(wbRecord.parentId, anchor.id));
        previous = kids.filter((k) => isOutcome(k.kind) && isLive(k.state));
      } else if (isOutcome(anchor.kind) && anchor.parentId === null && anchor.personId === personId && isLive(anchor.state)) {
        const kids = await tx.select().from(wbRecord).where(eq(wbRecord.parentId, anchor.id));
        previous = kinOf(anchor, kids);
      } else {
        throw new Refusal("That isn't an outcome you can change.");
      }
    }
    const parentKind = parent?.kind ?? null;
    const now = new Date();

    const replaced = previous.map((p) => p.id);
    const cancel = async () => {
      if (!replaced.length) return;
      await tx
        .update(wbRecord)
        .set({ state: "CANCELLED", decisionNote: `Corrected by ${by}`, updatedAt: now })
        .where(inArray(wbRecord.id, replaced));
    };

    // ---------------------------------------------------------------- nothing given
    if (!input.mc && !input.statuses.length) {
      if (!parent) throw new Refusal(replaced.length ? "To take an MC or status off, ask your PS to void it." : "Nothing to record.");
      await cancel();
      await tx.update(wbRecord).set({ outcomeAt: now, updatedAt: now }).where(eq(wbRecord.id, parent.id));
      await wbAudit(tx, { memberId: actor.id, via, action: "record-outcome", entity: "wb_record", entityId: parent.id, after: { nothing: true, replaces: replaced.length ? replaced : undefined } });
      return { ids: [] as string[], anchorId: parent.id, replaced };
    }

    // ---------------------------------------------------------------- the paper
    let fileId = input.photoFileId;
    if (!fileId) fileId = previous.find((p) => p.evidenceFileId)?.evidenceFileId ?? null;
    if (!fileId) throw new Refusal("Add a photo of the document.");

    const mc = input.mc;
    if (mc) {
      if (!mc.category.trim()) throw new Refusal(`Say what the ${mc.kind} was for.`);
      if (!mc.diagnosis.trim()) throw new Refusal("Copy the diagnosis from the paper.");
      if (asksSeenBy(parentKind) && !mc.seenBy) throw new Refusal("Say who you saw: the camp MO or a civilian doctor.");
      checkDates(`The ${mc.kind}`, mc.startDate, mc.endDate, MC_MAX_DAYS, today);
    }
    input.statuses.forEach((st, i) => {
      if (!st.label.trim()) throw new Refusal(`Say which status (status ${i + 1}).`);
      checkDates(`Status ${i + 1}`, st.startDate, st.endDate, STATUS_MAX_DAYS, today);
    });

    // one created_at for every row: it's what ties one outcome together (decide.ts outcomeBatch)
    const headId = randomUUID();
    const hangOff = parent?.id ?? null;
    const common = {
      personId,
      memberId: actor.id,
      state: "RECORDED" as const,
      evidenceFileId: fileId,
      createdBy: actor.id,
      createdVia: "SELF" as const,
      createdAt: now,
      updatedAt: now,
    };
    const rows: (typeof wbRecord.$inferInsert)[] = [];
    if (mc) {
      const r = dateRange(mc.startDate, mc.endDate);
      rows.push({
        ...common,
        id: headId,
        parentId: hangOff,
        kind: mc.kind,
        startAt: r.startAt,
        endAt: r.endAt,
        absent: true,
        detail: mc.kind,
        mcCategory: mc.category.trim().slice(0, 40),
        diagnosis: mc.diagnosis.trim().slice(0, 200),
        seenBy: asksSeenBy(parentKind) ? mc.seenBy : null,
        onens: onensFor(mc.kind, parentKind, mc.seenBy, input.onensUploaded),
      });
    }
    input.statuses.forEach((st) => {
      const r = st.endDate ? dateRange(st.startDate, st.endDate) : { startAt: dateRange(st.startDate, st.startDate).startAt, endAt: null };
      const first = rows.length === 0;
      rows.push({
        ...common,
        id: first ? headId : randomUUID(),
        // standalone: the first row is the head and the rest hang off it
        parentId: hangOff ?? (first ? null : headId),
        kind: "STATUS",
        startAt: r.startAt,
        endAt: r.endAt,
        absent: false,
        detail: st.label.trim().toUpperCase().slice(0, 60),
      });
    });

    await cancel();
    await tx.insert(wbRecord).values(rows);
    if (parent) await tx.update(wbRecord).set({ outcomeAt: now, updatedAt: now }).where(eq(wbRecord.id, parent.id));
    // the audit names what was recorded, never the diagnosis
    await wbAudit(tx, {
      memberId: actor.id,
      via,
      action: "record-outcome",
      entity: "wb_record",
      entityId: headId,
      after: { kinds: rows.map((r) => r.kind), parentId: parent?.id ?? null, replaces: replaced.length ? replaced : undefined },
    });
    return { ids: rows.map((r) => r.id!), anchorId: parent?.id ?? headId, replaced };
  });
  if (!res.ok) return res;

  const { ids, anchorId, replaced } = res.value;
  const made = await recordViews(ids);
  const old = outcomeOrder(await recordViews(replaced));
  for (const o of old) await refreshCards(out, o);
  if (!made.length) {
    return { ok: true, value: { recordIds: [], anchorId, delivery: null, nothing: true } };
  }
  const batch = await outcomeBatch(made[0]);
  const delivery = await sendOutcomeCard(out, batch, old);
  await tell(out, batch[0], ownSummary(batch, old.length > 0));
  return { ok: true, value: { recordIds: ids, anchorId, delivery, nothing: false } };
}

/** The outcome card in the platoon's commanders chat: what, for how long, the category. Never the diagnosis or the photo. */
async function sendOutcomeCard(out: Outbound | null, batch: RecordView[], replaced: RecordView[]): Promise<Delivery> {
  const [chat] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, batch[0].subunitId));
  if (!chat) return "no-chat";
  if (!out) return "failed";
  try {
    const msg = await out.api.sendMessage(chat.chatId, outcomeCardText(batch, { replaces: replaced.map(recordWhat) }), {
      message_thread_id: chat.threadId ?? undefined,
      reply_markup: outcomeKeyboard(batch, out.botUsername),
    });
    await db.insert(wbCard).values({ recordId: batch[0].id, chatId: chat.chatId, threadId: chat.threadId, messageId: msg.message_id });
    return "sent";
  } catch (e) {
    console.error("wb outcome card:", e);
    return "failed";
  }
}

function ownSummary(batch: RecordView[], corrected: boolean): string {
  const lines = [corrected ? "✏️ Corrected" : "✅ Recorded", batch.map(recordWhat).join("\n")];
  if (batch.some((r) => r.onens === "OWED")) lines.push("☁️ Still to upload to ONENS. I'll remind you each evening until you tap Uploaded.");
  if (batch.some((r) => r.kind === "STATUS")) lines.push("A status keeps you present on the parade state.");
  return lines.join("\n\n");
}

/**
 * "Uploaded to ONENS": the trooper on his own MC, or a commander who decides
 * for him. Only an MC that is owed.
 */
export async function markOnens(out: Outbound | null, actor: Actor, recordId: string, via: Via): Promise<{ ok: true; record: RecordView } | { ok: false; error: string }> {
  const r = await recordView(recordId);
  if (!r) return { ok: false, error: "That record has gone." };
  const owner = !!actor.personId && actor.personId === r.personId;
  if (!owner && !canDecide(actor.grants, r)) return { ok: false, error: "That isn't yours." };
  const res = await inTx(async (tx) => {
    const [row] = await tx
      .update(wbRecord)
      .set({ onens: "DONE", updatedAt: new Date() })
      .where(and(eq(wbRecord.id, recordId), eq(wbRecord.onens, "OWED"), inArray(wbRecord.state, ["RECORDED"])))
      .returning({ id: wbRecord.id });
    if (!row) throw new Refusal("Nothing is owed on ONENS for that.");
    await wbAudit(tx, { memberId: actor.id, via, action: "onens-done", entity: "wb_record", entityId: recordId, before: { onens: "OWED" }, after: { onens: "DONE" } });
  });
  if (!res.ok) return res;
  const after = (await recordView(recordId))!;
  await refreshCards(out, after);
  return { ok: true, record: after };
}
