
// What may happen to a record, and who may make it happen. Pure: no I/O.
// Ports Sabre Bot's engine.py decide/undo/void and store.py refunds.

/** wb_record.kind. Complete now; Phase 3 uses the medical ones. */
export const WB_RECORD_KINDS = ["RSI", "RSO", "MC", "HL", "STATUS", "MA", "AL", "OL", "OFF", "EVENT"] as const;
export type WbRecordKind = (typeof WB_RECORD_KINDS)[number];

export const WB_RECORD_STATES = ["PENDING", "APPROVED", "REJECTED", "RECORDED", "CANCELLED", "WITHDRAWN"] as const;
export type WbRecordState = (typeof WB_RECORD_STATES)[number];

/** Requests a commander can refuse. MA and EVENT are facts: recorded, not approved. */
export const APPROVAL_KINDS: readonly WbRecordKind[] = ["AL", "OL", "OFF", "RSI", "RSO"];
/** The kinds that cost leave days. */
export const LEAVE_KINDS: readonly WbRecordKind[] = ["AL", "OL"];

/** A SELF member who isn't on the roster yet: every record needs a roster person. */
export const NOT_ON_ROSTER = "Ask your PS to add you to the parade state first.";

/** wb_record.onens. NA: nothing to upload; OWED: a civilian MC not on ONENS yet; DONE: uploaded. */
export const WB_ONENS = ["NA", "OWED", "DONE"] as const;
export type WbOnens = (typeof WB_ONENS)[number];
export const WB_SEEN_BY = ["MO", "CIVILIAN"] as const;
export type WbSeenBy = (typeof WB_SEEN_BY)[number];

export const needsApproval = (kind: WbRecordKind) => APPROVAL_KINDS.includes(kind);
export const costsLeave = (kind: WbRecordKind) => LEAVE_KINDS.includes(kind);
export const initialState = (kind: WbRecordKind): WbRecordState => (needsApproval(kind) ? "PENDING" : "RECORDED");

/** States that no longer mean anything: they never clash and never count. */
export const DEAD_STATES: readonly WbRecordState[] = ["REJECTED", "CANCELLED", "WITHDRAWN"];
export const isLive = (s: WbRecordState) => !DEAD_STATES.includes(s);
/** States that are true: the person really is away. */
export const STANDING_STATES: readonly WbRecordState[] = ["APPROVED", "RECORDED"];

// ------------------------------------------------------------------ medical

/** A visit to a doctor: what an outcome hangs off. */
export const VISIT_KINDS: readonly WbRecordKind[] = ["RSI", "RSO", "MA"];
/** What the doctor gave him. Always RECORDED, never approved. */
export const OUTCOME_KINDS: readonly WbRecordKind[] = ["MC", "HL", "STATUS"];
export const isOutcome = (kind: WbRecordKind) => OUTCOME_KINDS.includes(kind);

/**
 * Whether a kind takes him off the parade state. Reporting sick never does,
 * in camp or out: he goes to the doctor and comes back. What the doctor gives
 * him (an MC or HL) is what takes him off, as its own row with its own dates.
 * A STATUS (light duty) keeps him present.
 */
export function isAbsentKind(kind: WbRecordKind): boolean {
  return !(kind === "RSI" || kind === "RSO" || kind === "STATUS");
}

export interface VisitRow {
  kind: WbRecordKind;
  state: WbRecordState;
  personId: string;
}

/**
 * Why an outcome can't be recorded against this record, or null if it can.
 * Only a report sick a commander has approved, or an MA (recorded, no
 * approval), is a visit a doctor's paper can come out of.
 */
export function outcomeParentRefusal(parent: VisitRow, personId: string): string | null {
  if (parent.personId !== personId) return "That isn't yours.";
  if (!VISIT_KINDS.includes(parent.kind)) return "An outcome goes on a report sick or a medical appointment.";
  if (parent.kind === "MA" ? parent.state !== "RECORDED" : parent.state !== "APPROVED") {
    return parent.state === "PENDING" ? "Your commander hasn't approved this report sick yet." : "That report sick wasn't approved, so there's no outcome to record.";
  }
  return null;
}

/**
 * Whether the MC still has to go up on ONENS. An MC from the camp MO is on
 * ONENS already; only a civilian doctor's is ever owed. An RSO says so by
 * itself; an RSI is the MO; with no report sick above it (standalone, or an
 * MA, which is usually at a civilian hospital) he's asked who he saw.
 */
export function onensFor(kind: WbRecordKind, parentKind: WbRecordKind | null, seenBy: WbSeenBy | null, uploaded: boolean): WbOnens {
  if (kind !== "MC" && kind !== "HL") return "NA";
  const civilian = parentKind === "RSO" || ((parentKind === null || parentKind === "MA") && seenBy === "CIVILIAN");
  if (!civilian) return "NA";
  return uploaded ? "DONE" : "OWED";
}

/** Whether the form asks "Who did you see?": only when no report sick says so. */
export const asksSeenBy = (parentKind: WbRecordKind | null) => parentKind === null || parentKind === "MA";

/**
 * A record and whatever it produced (Sabre Bot's _void_kin). An RSO and the MC
 * it turned into are one afternoon: voiding half of it leaves an MC belonging
 * to a report sick that never happened. Direct children only, live only.
 */
export function kinOf<R extends { id: string; parentId: string | null; state: WbRecordState }>(head: R, rows: readonly R[]): R[] {
  return [head, ...rows.filter((r) => r.parentId === head.id && r.id !== head.id && isLive(r.state))];
}

/** Statuses on one paper. More than this is a second entry. */
export const MAX_STATUSES = 4;

/** Marks a record approved at submission because its owner needs no approval (domain/access.ts needsNoApproval). */
export const NO_APPROVAL_NOTE = "No approval needed";

// ------------------------------------------------------------------ report for your men (2026-10-24)

/**
 * What a commander may put on a man's timeline for him (createdVia PROXY):
 * report sick, an MA, and an event. Never leave or off: those are his own
 * requests, and leave spends his balance.
 */
export const PROXY_KINDS: readonly WbRecordKind[] = ["RSI", "RSO", "MA", "EVENT"];
/** The reported kinds: a visit the man is told about and can say "Not right" to. */
export const REPORTED_KINDS: readonly WbRecordKind[] = VISIT_KINDS;

export function proxyRefusal(kind: WbRecordKind): string | null {
  if (PROXY_KINDS.includes(kind)) return null;
  return costsLeave(kind) || kind === "OFF" ? "Leave and off are his own to apply for." : "That's his to record.";
}

/** A reported report sick, saved approved because the reporter could approve it himself. */
export const reportedApprovedNote = (reporter: string) => `Reported and approved by ${reporter}`;
const REPORTED_APPROVED = /^Reported and approved by /;

/** The man said a report made for him isn't right: withdrawn while pending, cancelled once it stood. */
export const NOT_RIGHT_NOTE = "Not right, says the man";

/** Report sick (RSI or RSO) is one visit whichever way he went; an MA is another. Duplicates are checked within a family. */
export const visitFamily = (kind: WbRecordKind): readonly WbRecordKind[] => (kind === "MA" ? ["MA"] : kind === "RSI" || kind === "RSO" ? ["RSI", "RSO"] : [kind]);

/** Why the man can't say "Not right" to this record, or null if he can. */
export function notRightRefusal(r: { kind: WbRecordKind; state: WbRecordState; createdVia: string; personId: string }, personId: string | null): string | null {
  if (!personId || r.personId !== personId) return "Only the man it's about can say it's not right.";
  if (r.createdVia !== "PROXY" || !REPORTED_KINDS.includes(r.kind)) return "Only a report someone made for you can be marked Not right.";
  if (r.state === "PENDING" || STANDING_STATES.includes(r.state)) return null;
  return "It's already off your records.";
}

// ------------------------------------------------------------------ what

export type RecordAction = "approve" | "reject" | "withdraw" | "void" | "undo";

const TRANSITIONS: Record<RecordAction, { from: readonly WbRecordState[]; to: WbRecordState }> = {
  approve: { from: ["PENDING"], to: "APPROVED" },
  reject: { from: ["PENDING"], to: "REJECTED" },
  withdraw: { from: ["PENDING"], to: "WITHDRAWN" },
  void: { from: ["APPROVED", "RECORDED"], to: "CANCELLED" },
  undo: { from: ["APPROVED", "REJECTED"], to: "PENDING" },
};

/** The state an action leads to, or null if it can't happen from here. */
export function nextState(from: WbRecordState, action: RecordAction): WbRecordState | null {
  const t = TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}

/** Undo lives for ten minutes, for the thumb that decided. After that he's been told and has made plans. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface Decided {
  state: WbRecordState;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote?: string | null;
}

/**
 * Saved approved: its owner needs no approval (OC/2IC/CSM), or whoever
 * reported it for him could approve it himself (2026-10-24). Its note is the
 * card's decision line, and there's no Undo, only Void.
 */
export const approvedOnSave = (r: { state: WbRecordState; decisionNote?: string | null }) =>
  r.state === "APPROVED" && (r.decisionNote === NO_APPROVAL_NOTE || REPORTED_APPROVED.test(r.decisionNote ?? ""));

/** Why this member can't undo this decision now, or null if they can. Checked lazily on tap: no cron. */
export function undoRefusal(r: Decided, memberId: string, deciderLabel: string, now: Date = new Date()): string | null {
  if (r.state === "PENDING") return "That's already waiting on a decision.";
  if (approvedOnSave(r))
    return r.decisionNote === NO_APPROVAL_NOTE
      ? "It never needed approval, so there's nothing to take back. Void it instead."
      : "It was approved as it was reported, so there's nothing to take back. Void it instead.";
  if (!nextState(r.state, "undo")) return "That can't be taken back.";
  if (r.decidedBy !== memberId) return `Only ${deciderLabel} can take that back.`;
  if (!r.decidedAt || now.getTime() - r.decidedAt.getTime() > UNDO_WINDOW_MS) return "Too late to undo. Tell them yourself instead.";
  return null;
}

/**
 * How an action changes the trooper's leave balance. Approving is what spends
 * the days, so only undoing or voiding an *approved* leave gives them back: a
 * rejection never cost anything.
 */
export function leaveChange(kind: WbRecordKind, from: WbRecordState, action: RecordAction, leaveDays: number | null): number {
  if (!costsLeave(kind) || !leaveDays) return 0;
  if (action === "approve" && from === "PENDING") return -leaveDays;
  if ((action === "undo" || action === "void") && from === "APPROVED") return leaveDays;
  return 0;
}

/**
 * He can't apply for more than he holds. Refused at the form rather than left
 * for the commander: a request that can only be refused wastes everyone's time.
 */
export function leaveRefusal(days: number, left: number): string | null {
  if (days < 1) return "Tick at least one day. If none of them cost you leave, apply for Off instead.";
  if (days > left) {
    return (
      `That's ${days} day${days === 1 ? "" : "s"} of leave and you have ${left} left. ` +
      "Untick the days you're off shift or that fall on a public holiday. If the balance itself is wrong, ask your PS."
    );
  }
  return null;
}

// ------------------------------------------------------------------ what's current

/**
 * A rejected request stays in the default view of My records and Person
 * history for this long after the decision, so the trooper sees it and the
 * reason. After that it's in Full history only.
 */
export const REJECTED_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;

export interface CurrentRow {
  kind: WbRecordKind;
  state: WbRecordState;
  /** null = open-ended (a permanent status) */
  endAt: Date | null;
  decidedAt: Date | null;
  outcomeAt: Date | null;
  onens: WbOnens;
}

const over = (r: { endAt: Date | null }, now: Date) => r.endAt !== null && r.endAt.getTime() <= now.getTime();

/**
 * A visit still waiting on the trooper to say what the doctor gave: an
 * approved report sick or a recorded MA, with no outcome and no "nothing
 * given" yet (My records' Update outcome button).
 */
export function awaitsOutcome(r: CurrentRow, children: readonly CurrentRow[]): boolean {
  if (!VISIT_KINDS.includes(r.kind) || r.outcomeAt) return false;
  if (r.state !== (r.kind === "MA" ? "RECORDED" : "APPROVED")) return false;
  return !children.some((c) => isOutcome(c.kind) && isLive(c.state));
}

/**
 * Whether a record belongs in the default (current) view, given its live
 * children (what a visit produced). Current means: waiting on a decision;
 * standing and not over yet (open-ended counts); still owing something (an
 * outcome to record, an MC to upload to ONENS), itself or through a child;
 * or rejected in the last week, while its dates haven't passed. Withdrawn,
 * voided, corrected and finished records are history.
 */
export function isCurrent(r: CurrentRow, children: readonly CurrentRow[], now: Date): boolean {
  switch (r.state) {
    case "PENDING":
      return true;
    case "REJECTED":
      return !!r.decidedAt && now.getTime() - r.decidedAt.getTime() < REJECTED_SHOWN_MS && !over(r, now);
    case "APPROVED":
    case "RECORDED":
      return (
        !over(r, now) ||
        r.onens === "OWED" ||
        awaitsOutcome(r, children) ||
        children.some((c) => STANDING_STATES.includes(c.state) && isCurrent(c, [], now))
      );
    default:
      return false;
  }
}

/**
 * My records' grouping: what a doctor gave sits under the visit (or standalone
 * MC) it came from, live rows only, so one afternoon reads as one entry. Rows
 * whose parent is in the list never show on their own, and a corrected outcome
 * isn't repeated. Keeps the given order.
 */
export function nestOutcomes<R extends { id: string; parentId: string | null; state: WbRecordState; decisionNote: string | null }>(
  all: readonly R[],
): { top: R[]; under: Map<string, R[]> } {
  const ids = new Set(all.map((r) => r.id));
  const under = new Map<string, R[]>();
  for (const r of all) {
    if (r.parentId && ids.has(r.parentId) && isLive(r.state)) under.set(r.parentId, [...(under.get(r.parentId) ?? []), r]);
  }
  const top = all.filter((r) => !(r.parentId && ids.has(r.parentId)) && !(r.state === "CANCELLED" && r.decisionNote?.startsWith("Corrected by")));
  return { top, under };
}

/** Each record's live children, for a flat list (Person history). */
export function liveChildren<R extends { id: string; parentId: string | null; state: WbRecordState }>(all: readonly R[]): Map<string, R[]> {
  const under = new Map<string, R[]>();
  for (const r of all) if (r.parentId && isLive(r.state)) under.set(r.parentId, [...(under.get(r.parentId) ?? []), r]);
  return under;
}
