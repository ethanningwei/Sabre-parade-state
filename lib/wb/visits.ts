import "server-only";
import type { OutcomeAnswers } from "@/components/tg/apply/outcome-form";
import { outcomeOrder } from "@/lib/wb/decide";
import { isLive, isOutcome, VISIT_KINDS, type WbSeenBy } from "@/lib/wb/domain/rules";
import { toSgt } from "@/lib/parade/time";
import { childrenOf, recordView, type RecordView } from "@/lib/wb/records";

const toSgtDate = (d: Date) => toSgt(d).date;

// A visit to a doctor as one thing: the RSI/RSO/MA (or, with none, the
// standalone MC or status at the head) and what the doctor gave.

export interface Visit {
  /** the RSI/RSO/MA, or the standalone outcome's head */
  anchor: RecordView;
  /** the anchor's kind when it's a visit; null for a standalone outcome */
  parentKind: "RSI" | "RSO" | "MA" | null;
  /** the outcome rows still standing (a standalone head included) */
  outcome: RecordView[];
}

/** The visit any record belongs to, or null if it isn't medical. */
export async function visitOf(recordId: string): Promise<Visit | null> {
  let r = await recordView(recordId);
  if (!r) return null;
  // an outcome under something: climb to its anchor (a visit, or a standalone head)
  if (isOutcome(r.kind) && r.parentId) r = (await recordView(r.parentId)) ?? r;
  if (VISIT_KINDS.includes(r.kind)) {
    const kids = await childrenOf([r.id]);
    return { anchor: r, parentKind: r.kind as Visit["parentKind"], outcome: outcomeOrder(kids.filter((k) => isOutcome(k.kind) && isLive(k.state))) };
  }
  if (isOutcome(r.kind)) {
    const kids = await childrenOf([r.id]);
    const live = isLive(r.state) ? [r, ...kids.filter((k) => isLive(k.state))] : [];
    return { anchor: r, parentKind: null, outcome: outcomeOrder(live) };
  }
  return null;
}

/** The form's answers for what's recorded now, for a correction. */
export function answersFrom(outcome: RecordView[], diagnoses: Map<string, string>, today: string): OutcomeAnswers {
  const mc = outcome.find((r) => r.kind === "MC" || r.kind === "HL");
  const statuses = outcome.filter((r) => r.kind === "STATUS");
  const lastDay = (r: RecordView) => (r.endAt ? toSgtDate(new Date(r.endAt.getTime() - 1)) : today);
  return {
    gotMc: !!mc,
    gotStatus: statuses.length > 0,
    mcKind: mc?.kind === "HL" ? "HL" : "MC",
    category: mc?.mcCategory === "Other" ? "OTHER" : (mc?.mcCategory ?? ""),
    diagnosis: mc ? (diagnoses.get(mc.id) ?? "") : "",
    mcStart: mc ? toSgtDate(mc.startAt) : today,
    mcEnd: mc ? lastDay(mc) : today,
    seenBy: (mc?.seenBy as WbSeenBy | null) ?? null,
    statuses: statuses.map((s) => ({
      permanent: s.endAt === null,
      type: s.detail === "LIGHT DUTY" ? "LIGHT DUTY" : "OTHER",
      other: s.detail === "LIGHT DUTY" ? "" : s.detail,
      startDate: toSgtDate(s.startAt),
      endDate: s.endAt ? lastDay(s) : toSgtDate(s.startAt),
    })),
    onensUploaded: mc ? mc.onens === "DONE" : null,
  };
}
