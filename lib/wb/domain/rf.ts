import { hasGrant, type GrantRow } from "./grants";
import type { WbRole } from "./roles";
import { overlaps, rangeLabel, type Range } from "./timeline";

// RF requests, deploying men to them, and Extra/RF/SOL assignments. Pure: no
// I/O. Ports Sabre Bot's config.py (RF_ROLES, RF_REQUESTERS, RF_DEPLOYERS,
// ASSIGN_TYPES), store.py (RFRequest.short, fill/close) and engine.py
// (_rf_card, _rf_buttons).
//
// A request is a demand, not a fact: it can go unfilled, be filled from two
// platoons, or be closed because the shift got covered another way. Each man
// actually sent is his own wb_assignment, which is what the forecast reads.

/** What an RF request can ask for: guardroom appointments, or any pair of hands. */
export const RF_ROLES = ["GC", "ST CBT", "ST SVC", "ANY"] as const;
export type RfRole = (typeof RF_ROLES)[number];

export const WB_RF_STATES = ["OPEN", "FILLED", "CLOSED"] as const;
export type WbRfState = (typeof WB_RF_STATES)[number];

/** The three things that move a man between guardrooms without changing where he's posted. */
export const WB_ASSIGNMENT_TYPES = ["EXTRA", "RF", "SOL"] as const;
export type WbAssignmentType = (typeof WB_ASSIGNMENT_TYPES)[number];
export const WB_ASSIGNMENT_STATES = ["ACTIVE", "CANCELLED"] as const;
export type WbAssignmentState = (typeof WB_ASSIGNMENT_STATES)[number];

export const ASSIGNMENT_LABEL: Record<WbAssignmentType, string> = { EXTRA: "Extra", RF: "RF", SOL: "SOL" };

/** How many men one request may ask for, and how many men one Assign may cover. */
export const MAX_NEED = 10;
export const MAX_ASSIGN = 40;
/** Filled and closed requests stay on the board this long. */
export const BOARD_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ who

/**
 * Raise, deploy and assign: Sabre Bot's GC and every HQ role (GC, PC, PS, OC,
 * 2IC, CSM, ASA), each within their grant (decided 2026-10-13). A GC answers
 * for his own camp and its men, a PC/PS for their platoon, OC/2IC/CSM/ASA
 * company-wide. Asking for manpower and finding it are different jobs done by
 * the same men.
 */
export const RF_GRANT_ROLES: readonly WbRole[] = ["GC", "PC", "PS", "OC", "2IC", "CSM", "ASA"];

export interface Where {
  subunitId: string;
  campId: string;
}

/** Raise (and close) a request for this camp. */
export const canRaiseRf = (grants: readonly GrantRow[], camp: Where) => hasGrant(grants, RF_GRANT_ROLES, camp);
/** Send this man somewhere (deploy him to a request, or assign him Extra/RF/SOL), or stand him down. */
export const canDeployRf = (grants: readonly GrantRow[], man: Where) => hasGrant(grants, RF_GRANT_ROLES, man);
/** Holds any RF role at all: sees the RF board, Raise RF and Assign. */
export const rfAnything = (grants: readonly GrantRow[]) => hasGrant(grants, RF_GRANT_ROLES, "any");

// ------------------------------------------------------------------ the request

export interface RfDeployed {
  assignmentId: string;
  personId: string;
  rank: string;
  name: string;
  /** his home camp */
  campId: string;
  campName: string;
  subunitId: string;
}

export interface RfRequestView extends Range {
  id: string;
  campId: string;
  campName: string;
  subunitId: string;
  subunitName: string;
  role: RfRole;
  need: number;
  reason: string;
  state: WbRfState;
  raisedById: string | null;
  /** "2SG TAN" */
  raisedBy: string;
  raisedByTelegramId: number | null;
  closedBy: string | null;
  createdAt: Date;
  /** live assignments only, in the order they were sent */
  deployed: readonly RfDeployed[];
}

/** How many more men it needs. */
export const shortBy = (r: { need: number; deployed: readonly unknown[] }) => Math.max(0, r.need - r.deployed.length);

/** Over once its last moment has passed: a request for a shift already stood is history. */
export const isOver = (r: Range, now: Date) => r.endAt !== null && r.endAt.getTime() <= now.getTime();

/** "1x GC", "2x any role" */
export const wants = (r: { need: number; role: RfRole }) => `${r.need}x ${r.role === "ANY" ? "any role" : r.role}`;

/** What a request's state should be after a man is sent or stood down. CLOSED stays CLOSED. */
export function stateAfter(state: WbRfState, need: number, live: number): WbRfState {
  if (state === "CLOSED") return "CLOSED";
  return live >= need ? "FILLED" : "OPEN";
}

/** "PTE TAN (SFT A)" */
export const deployedLabel = (d: Pick<RfDeployed, "rank" | "name" | "campName">) => `${d.rank} ${d.name} (${d.campName})`;

/** The state line: "⏳ Still short 1 of 2", "✅ FILLED", "❌ CLOSED — no longer needed". */
export function rfStateLine(r: RfRequestView, now: Date = new Date()): string {
  if (r.state === "FILLED") return "✅ FILLED";
  if (r.state === "CLOSED") return `❌ CLOSED — no longer needed${r.closedBy ? ` (${r.closedBy})` : ""}`;
  if (isOver(r, now)) return `⌛ Over, still short ${shortBy(r)} of ${r.need}`;
  return `⏳ Still short ${shortBy(r)} of ${r.need}`;
}

/**
 * The card: the shape the company already writes by hand (Camp, Duration,
 * Manpower required, Reason), plus the two things a handwritten notice never
 * has: what's still outstanding, and who asked. Plain text, no parse mode.
 */
export function rfCardText(r: RfRequestView, now: Date = new Date()): string {
  const lines = [
    "🚌 RF REQUEST",
    "",
    `Camp: ${r.campName} · ${r.subunitName}`,
    `Duration: ${rangeLabel(r)}`,
    `Manpower required: ${wants(r)}`,
    `Reason: ${r.reason}`,
  ];
  if (r.deployed.length) lines.push(`Manpower deployed: ${r.deployed.map(deployedLabel).join(", ")}`);
  lines.push("", rfStateLine(r, now), `raised by ${r.raisedBy}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ the card's buttons

/** Close on a card: f:<requestId>:x (Deploy opens the Mini App, so it's a link). */
export const RF_CALLBACK = /^f:([0-9a-f-]{36}):x$/;
export const rfCloseData = (requestId: string) => `f:${requestId}:x`;

export interface RfButton {
  text: string;
  /** a Mini App route (a link) or callback data */
  route?: string;
  data?: string;
}

/**
 * OPEN: Deploy someone + Close. The raiser's own copy gets Close and nothing
 * else: he asked because he had none to spare, and offering him Deploy invites
 * him to answer his own request. Everything else: Open only.
 */
export function rfButtons(r: { id: string; state: WbRfState }, own: boolean): RfButton[][] {
  const open: RfButton = { text: "Open", route: `rf/${r.id}` };
  if (r.state !== "OPEN") return [[open]];
  const close: RfButton = { text: "❌ Close", data: rfCloseData(r.id) };
  return own ? [[close], [open]] : [[{ text: "📌 Deploy someone", route: `rf/${r.id}/deploy` }, close], [open]];
}

// ------------------------------------------------------------------ refusals

export interface LiveAssignment extends Range {
  id: string;
  personId: string;
  type: WbAssignmentType;
  campId: string;
  campName: string;
}

export interface Man extends Where {
  personId: string;
  rank: string;
  name: string;
  campName: string;
}

/** Already spoken for over these times: "RF @ BDK 14/10–15/10". Overlapping live assignments only. */
export function busyOver(personId: string, range: Range, assignments: readonly LiveAssignment[]): LiveAssignment[] {
  return assignments.filter((a) => a.personId === personId && overlaps(a, range));
}

export const assignmentLine = (a: Pick<LiveAssignment, "type" | "campName"> & Range) => `${ASSIGNMENT_LABEL[a.type]} @ ${a.campName} ${rangeLabel(a)}`;

/**
 * Why this man can't be sent to this request, or null. Not his own camp (v1:
 * RF is served at another team); not someone already sent somewhere then; not
 * once it's closed, filled or over. Being down as away (leave, MC) is a
 * warning on the deploy screen, never a veto: a commander may know better.
 */
export function deployRefusal(r: RfRequestView, man: Man, assignments: readonly LiveAssignment[], now: Date = new Date()): string | null {
  if (r.state === "CLOSED") return "That request has been closed.";
  if (r.state === "FILLED" || shortBy(r) === 0) return "Somebody got there first: that request is already filled.";
  if (isOver(r, now)) return "That RF is already over.";
  if (man.campId === r.campId) return `${man.rank} ${man.name} is ${r.campName}'s own. RF is served at another camp.`;
  const busy = busyOver(man.personId, r, assignments);
  if (busy.length) return `${man.rank} ${man.name} is already on ${assignmentLine(busy[0])}.`;
  return null;
}

/** Why this man can't be assigned Extra/RF at this camp (SOL: campId is his own), or null. */
export function assignRefusal(type: WbAssignmentType, campId: string | null, man: Man, range: Range, assignments: readonly LiveAssignment[]): string | null {
  if (type !== "SOL") {
    if (!campId) return "Pick the camp they're serving at.";
    if (campId === man.campId) return `${ASSIGNMENT_LABEL[type]} can't be served at his own team (${man.campName}). Pick another camp.`;
  }
  const busy = busyOver(man.personId, range, assignments);
  if (busy.length) return `${man.rank} ${man.name} is already on ${assignmentLine(busy[0])}.`;
  return null;
}

// ------------------------------------------------------------------ the man's messages

/** "RF @ SLR 14/10 2100–15/10 0900\nAbsent from SFT A, counted at SLR." */
export function sentLine(type: WbAssignmentType, range: Range, at: string, home: string): string {
  if (type === "SOL") return `SOL ${rangeLabel(range)}\nYour leave is stopped. You stand with ${home} while your team is on, and with the other team of your camp while it's off.`;
  return `${ASSIGNMENT_LABEL[type]} @ ${at} ${rangeLabel(range)}\nAbsent from ${home}, counted at ${at}.`;
}

/** The DM to a man sent somewhere, with what he's already down for then. */
export function sentNotice(opts: { type: WbAssignmentType; range: Range; at: string; home: string; by: string; viaRequest: boolean; away: readonly string[] }): string {
  const head = opts.type === "SOL" ? "⛔ You're on SOL" : opts.viaRequest ? "🚌 You've been sent on RF" : `📌 You've been put on ${ASSIGNMENT_LABEL[opts.type]}`;
  const report = opts.type === "SOL" ? "" : ` Report to ${opts.at}.`;
  const warn = opts.away.length ? `\n\n⚠️ I have you down as away then\n${opts.away.map((l) => `• ${l}`).join("\n")}\n\nIf that's still right, tell whoever sent you.` : "";
  return `${head}\n\n${sentLine(opts.type, opts.range, opts.at, opts.home)}\n\nSent by ${opts.by}.${report}${warn}`;
}

/** The DM when he's stood down. */
export function standDownNotice(opts: { type: WbAssignmentType; range: Range; at: string; by: string }): string {
  const what = opts.type === "SOL" ? `SOL ${rangeLabel(opts.range)}` : `${ASSIGNMENT_LABEL[opts.type]} @ ${opts.at} ${rangeLabel(opts.range)}`;
  return `↩️ Stood down\n\n${what}\n\n${opts.by} cancelled it. You're back with your own camp.`;
}

/**
 * The line to his own platoon's commanders: a head down, and what it does to
 * his camp. "🚌 Sent on RF by 2SG TAN\n\nPTE LIM (SFT A)\nRF @ SLR …"
 */
export function headDownText(opts: { type: WbAssignmentType; man: Man; range: Range; at: string; by: string; viaRequest: boolean; away: readonly string[]; manning: string | null }): string {
  const head = opts.viaRequest ? `🚌 Sent on RF by ${opts.by}` : `📌 ${ASSIGNMENT_LABEL[opts.type]} by ${opts.by}`;
  const parts = [head, `${opts.man.rank} ${opts.man.name} (${opts.man.campName})\n${sentLine(opts.type, opts.range, opts.at, opts.man.campName)}`];
  if (opts.away.length) parts.push(`⚠️ He's already down as away\n${opts.away.map((l) => `• ${l}`).join("\n")}`);
  if (opts.manning) parts.push(`${opts.manning.includes("BELOW MINIMUM") ? "⚠️" : "👥"} ${opts.manning}`);
  return parts.join("\n\n");
}

// ------------------------------------------------------------------ the deploy screen

export interface Candidate extends Man {
  role: string;
  /** what he's already down for then (leave, MC, an assignment): a warning */
  away: string[];
  /** refused outright (his own camp, already sent somewhere) */
  refusal: string | null;
  /** his home camp's manning line with him gone, or null when there's nothing to say */
  manning: string | null;
  /** his camp falls below minimum without him */
  short: boolean;
  /** his camp is off shift for all of it: the best man to send */
  free: boolean;
}

/** Does a man's role answer a request for this role? */
export const fits = (want: RfRole, role: string) => want === "ANY" || role === want;

/** Best first: fits and can go, his camp is off, nothing in the way, his camp stays above minimum; then by name. */
export function rankCandidates<C extends Candidate>(want: RfRole, all: readonly C[]): C[] {
  const score = (c: C) => [c.refusal ? 1 : 0, fits(want, c.role) ? 0 : 1, c.free ? 0 : 1, c.away.length ? 1 : 0, c.short ? 1 : 0] as const;
  return [...all].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return `${a.campName} ${a.name}`.localeCompare(`${b.campName} ${b.name}`);
  });
}

/**
 * One platoon's message for an Assign: the men, what and when, anything
 * they're already down for, and (Extra/RF) what it does to each camp they leave.
 */
export function assignedText(opts: { type: WbAssignmentType; men: readonly (Man & { away: readonly string[] })[]; range: Range; at: string | null; by: string; manning: readonly string[] }): string {
  const what = opts.type === "SOL" ? `SOL ${rangeLabel(opts.range)}` : `${ASSIGNMENT_LABEL[opts.type]} @ ${opts.at} ${rangeLabel(opts.range)}`;
  const men = opts.men.map((m) => `• ${m.rank} ${m.name} (${m.campName})${m.away.length ? `\n  ⚠️ already down as away: ${m.away.join("; ")}` : ""}`).join("\n");
  const foot = opts.type === "SOL" ? "Leave stopped. They stand with their own camp." : `Absent from their own camp, counted at ${opts.at}.`;
  const parts = [`📌 ${what}\nby ${opts.by}`, men, foot];
  if (opts.manning.length) parts.push(opts.manning.map((l) => `${l.includes("BELOW MINIMUM") ? "⚠️" : "👥"} ${l}`).join("\n"));
  return parts.join("\n\n");
}
