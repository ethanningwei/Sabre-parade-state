import { hasGrant, type GrantRow } from "./grants";
import type { WbRole } from "./roles";

// What may happen to a record, and who may make it happen. Pure: no I/O.
// Ports Sabre Bot's engine.py decide/undo/void and store.py refunds.

/** wb_record.kind. Complete now; Phase 3 uses the medical ones. */
export const WB_RECORD_KINDS = ["RSI", "RSO", "MC", "HL", "STATUS", "MA", "AL", "OL", "OFF", "EVENT"] as const;
export type WbRecordKind = (typeof WB_RECORD_KINDS)[number];

export const WB_RECORD_STATES = ["PENDING", "APPROVED", "REJECTED", "RECORDED", "CANCELLED", "WITHDRAWN"] as const;
export type WbRecordState = (typeof WB_RECORD_STATES)[number];

/** Requests a commander can refuse. MA and EVENT are facts: recorded, not approved. */
export const APPROVAL_KINDS: readonly WbRecordKind[] = ["AL", "OL", "OFF"];
/** The kinds that cost leave days. */
export const LEAVE_KINDS: readonly WbRecordKind[] = ["AL", "OL"];

export const needsApproval = (kind: WbRecordKind) => APPROVAL_KINDS.includes(kind);
export const costsLeave = (kind: WbRecordKind) => LEAVE_KINDS.includes(kind);
export const initialState = (kind: WbRecordKind): WbRecordState => (needsApproval(kind) ? "PENDING" : "RECORDED");

/** States that no longer mean anything: they never clash and never count. */
export const DEAD_STATES: readonly WbRecordState[] = ["REJECTED", "CANCELLED", "WITHDRAWN"];
export const isLive = (s: WbRecordState) => !DEAD_STATES.includes(s);
/** States that are true: the person really is away. */
export const STANDING_STATES: readonly WbRecordState[] = ["APPROVED", "RECORDED"];

// ------------------------------------------------------------------ who

/** Decide a platoon's requests: its PC or PS. */
export const PLATOON_DECIDERS: readonly WbRole[] = ["PC", "PS"];
/** Decide anyone's: company HQ. */
export const COMPANY_DECIDERS: readonly WbRole[] = ["OC", "2IC", "CSM"];
/** Add an event for several men: commanders, plus a camp's own GC. */
export const PROXY_ROLES: readonly WbRole[] = ["PC", "PS", "GC"];

/** Where the person a record is about stands. */
export interface Where {
  subunitId: string;
  campId: string;
}

/**
 * Approving, rejecting and voiding need a grant: the platoon's PC or PS, or
 * OC/2IC/CSM company-wide. Being in the commanders chat isn't enough (a change
 * from Sabre Bot), and GCs don't decide.
 */
export const canDecide = (grants: readonly GrantRow[], where: Where) =>
  hasGrant(grants, PLATOON_DECIDERS, where) || hasGrant(grants, COMPANY_DECIDERS, "company");

/** Whether someone decides anything at all (shows the Approvals screen). */
export const decidesAnything = (grants: readonly GrantRow[]) =>
  hasGrant(grants, PLATOON_DECIDERS, "any") || hasGrant(grants, COMPANY_DECIDERS, "company");

export const canProxy = (grants: readonly GrantRow[], where: Where) =>
  hasGrant(grants, PROXY_ROLES, where) || hasGrant(grants, COMPANY_DECIDERS, "company");

export const proxiesAnything = (grants: readonly GrantRow[]) =>
  hasGrant(grants, PROXY_ROLES, "any") || hasGrant(grants, COMPANY_DECIDERS, "company");

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
}

/** Why this member can't undo this decision now, or null if they can. Checked lazily on tap: no cron. */
export function undoRefusal(r: Decided, memberId: string, deciderLabel: string, now: Date = new Date()): string | null {
  if (r.state === "PENDING") return "That's already waiting on a decision.";
  if (!nextState(r.state, "undo")) return "That can't be taken back.";
  if (r.decidedBy !== memberId) return `Only ${deciderLabel} can take that back.`;
  if (!r.decidedAt || now.getTime() - r.decidedAt.getTime() > UNDO_WINDOW_MS) return "Too late to undo. Tell him yourself instead.";
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
