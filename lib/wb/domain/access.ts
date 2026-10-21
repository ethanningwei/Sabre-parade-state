import { isOver, type RfRequestView } from "./rf";
import type { WbRole } from "./roles";
import { nextState, outcomeParentRefusal, undoRefusal, type Decided, type VisitRow, type WbRecordKind } from "./rules";

// Who may: every role list and scope rule over grants, in one place. Pure, so
// the Mini App's pages, the bot and the write cores all ask the same thing.
//
// Each access object answers for one member and one thing. Its button fields
// (decide, void, close, …) say what he may do now, given the thing as loaded:
// pages draw their buttons from them. Its role fields (commands, approves,
// asks, sends, …) say whether his grants reach it at all, whatever its state:
// cores refuse with those, and keep their own in-transaction state guards and
// wording, since a page's view can always be stale.

export interface GrantRow {
  role: WbRole;
  subunitId: string | null;
  campId: string | null;
}

/** Where a man, the man a record is about, or a camp stands. */
export interface Where {
  subunitId: string;
  campId: string;
}

// ------------------------------------------------------------------ roles

const ADMIN: readonly WbRole[] = ["ADMIN"];
/** Decide a platoon's requests: its PC or PS. GCs don't decide. */
const PLATOON_DECIDERS: readonly WbRole[] = ["PC", "PS"];
/** Decide anyone's: company HQ. */
const COMPANY_DECIDERS: readonly WbRole[] = ["OC", "2IC", "CSM"];
/** Add an event for several men: commanders, plus a camp's own GC. */
const PROXIES: readonly WbRole[] = ["PC", "PS", "GC"];
/**
 * Raise, deploy and assign: Sabre Bot's GC and every HQ role, each within
 * their grant (decided 2026-10-13); ADMIN alone can't. Asking for manpower and
 * finding it are different jobs done by the same men.
 */
const RF_ROLES: readonly WbRole[] = ["GC", "PC", "PS", "OC", "2IC", "CSM", "ASA"];
/** Roster: adding, editing and moving men, and the accounts waiting to be added. */
const ROSTER_ROLES: readonly WbRole[] = ["GC", "PS", "PC", "OC", "2IC", "CSM", "ASA", "ADMIN"];
const PLATOON_REMOVERS: readonly WbRole[] = ["PC", "PS"];
const COMPANY_REMOVERS: readonly WbRole[] = ["OC", "2IC", "CSM", "ADMIN"];
/** "Back?" on a projected absence or duty (2026-10-14). */
const BACK_ROLES: readonly WbRole[] = ["GC", "PC", "PS", "OC", "2IC", "CSM"];
/** "Parade state": signs them in to the v1 web app by name. Troopers and ASAs don't get it. */
const PARADE_ROLES: readonly WbRole[] = ["GC", "PS", "PC", "OC", "2IC", "CSM", "ADMIN"];

// ------------------------------------------------------------------ reach

/** A GC's grant only ever reaches his camp: given without one, it counts for nothing (the user, 2026-10-21). */
export const onlyCampScope = (role: WbRole) => role === "GC";

/**
 * How far some grants carry: the whole company, or the platoons and camps
 * listed (both empty: nothing). Company-wide (no platoon or camp) covers
 * everything; a platoon grant covers its camps; a camp grant that camp only.
 */
export type Reach = "company" | { subunitIds: readonly string[]; campIds: readonly string[] };

function reachOf(grants: readonly GrantRow[], roles: readonly WbRole[]): Reach {
  const mine = grants.filter((g) => roles.includes(g.role) && (!onlyCampScope(g.role) || !!g.campId));
  if (mine.some((g) => !g.subunitId && !g.campId)) return "company";
  return {
    subunitIds: mine.flatMap((g) => (g.subunitId ? [g.subunitId] : [])),
    campIds: mine.flatMap((g) => (!g.subunitId && g.campId ? [g.campId] : [])),
  };
}

/**
 * Whether a man, a camp or a platoon is within reach. Someone or something
 * with no camp or platoon is company-wide only.
 */
export function inReach(reach: Reach, p: { subunitId: string | null; campId: string | null }): boolean {
  if (reach === "company") return true;
  return (!!p.subunitId && reach.subunitIds.includes(p.subunitId)) || (!!p.campId && reach.campIds.includes(p.campId));
}

const reachesAnything = (r: Reach) => r === "company" || r.subunitIds.length > 0 || r.campIds.length > 0;

/** Reach for the lists that are filtered in SQL as well as here: Roster, and v1's issues on Needs you. */
export function reach(viewer: { grants: readonly GrantRow[] }, kind: "roster" | "parade"): Reach {
  return reachOf(viewer.grants, kind === "roster" ? ROSTER_ROLES : PARADE_ROLES);
}

/** How far a reach goes, for a header. */
export function reachLabel(r: Reach): string {
  if (r === "company") return "The whole company";
  if (r.subunitIds.length) return r.campIds.length || r.subunitIds.length > 1 ? "Your platoons and camps" : "Your platoon";
  return r.campIds.length > 1 ? "Your camps" : "Your camp";
}

// the three shapes every rule below is made of
const at = (grants: readonly GrantRow[], roles: readonly WbRole[], p: { subunitId: string; campId?: string | null }) =>
  inReach(reachOf(grants, roles), { subunitId: p.subunitId, campId: p.campId ?? null });
const companyWide = (grants: readonly GrantRow[], roles: readonly WbRole[]) => reachOf(grants, roles) === "company";
const holds = (grants: readonly GrantRow[], roles: readonly WbRole[]) => reachesAnything(reachOf(grants, roles));

/** His platoon's PC or PS, or OC/2IC/CSM company-wide: viewing, voiding, medical, ONENS, Person history. */
const commandsAt = (grants: readonly GrantRow[], p: { subunitId: string; campId?: string | null }) =>
  at(grants, PLATOON_DECIDERS, p) || companyWide(grants, COMPANY_DECIDERS);
const decidesAnything = (grants: readonly GrantRow[]) => holds(grants, PLATOON_DECIDERS) || companyWide(grants, COMPANY_DECIDERS);

// ------------------------------------------------------------------ screens

export interface Screens {
  /** Inbox (approvals, ONENS owed) */
  inbox: boolean;
  /** Person history */
  people: boolean;
  /** Manpower (the day view and the 14-day grid) */
  manpower: boolean;
  hoto: boolean;
  /** RF and duties: the board, Ask for manpower, Deploy, Assign */
  rf: boolean;
  /** Add for several men */
  add: boolean;
  roster: boolean;
  shifts: boolean;
  admin: boolean;
  /** Parade state: the v1 web app inside Telegram */
  parade: boolean;
}
export type Screen = keyof Screens;

/** Which screens a member sees at all (Home's tiles, and each screen's gate). */
export function screens(viewer: { grants: readonly GrantRow[] }): Screens {
  const g = viewer.grants;
  const decides = decidesAnything(g);
  return {
    inbox: decides,
    people: decides,
    // a GC sees Manpower for his own camp (2026-10-16)
    manpower: decides || holds(g, ["GC"]),
    hoto: holds(g, ["GC", ...PLATOON_DECIDERS]) || companyWide(g, COMPANY_DECIDERS),
    rf: holds(g, RF_ROLES),
    add: holds(g, PROXIES) || companyWide(g, COMPANY_DECIDERS),
    roster: holds(g, ROSTER_ROLES),
    shifts: holds(g, ADMIN) || holds(g, PLATOON_DECIDERS),
    admin: holds(g, ADMIN),
    parade: holds(g, PARADE_ROLES),
  };
}

/** Company command and no platoon of his own: Needs you counts only what the company decides (2026-10-16). */
export const companyOnly = (viewer: { grants: readonly GrantRow[] }) =>
  companyWide(viewer.grants, COMPANY_DECIDERS) && !holds(viewer.grants, PLATOON_DECIDERS);

// ------------------------------------------------------------------ the approval chain

/** A request and whose it is: the roles the man it's about holds (wb_grant, any scope). */
export interface Request extends Where {
  personId: string;
  ownerRoles: readonly WbRole[];
}

/**
 * OC, 2IC and CSM record their own leave, off and report sick without asking
 * anyone (the user, 2026-10-14): it's approved the moment it's saved.
 */
export const needsNoApproval = (viewer: { grants: readonly GrantRow[] }) => holds(viewer.grants, COMPANY_DECIDERS);

/** The platoon roles that may decide this man's requests: a PS's go to the PC, a PC's (and company HQ's) to OC/2IC/CSM only. */
function platoonDecidersFor(ownerRoles: readonly WbRole[]): readonly WbRole[] {
  if (ownerRoles.some((r) => r === "PC" || COMPANY_DECIDERS.includes(r))) return [];
  if (ownerRoles.includes("PS")) return ["PC"];
  return PLATOON_DECIDERS;
}

/**
 * Approving or rejecting needs someone above the man who asked (the user,
 * 2026-10-14): a trooper's or GC's request goes to his PC or PS, a PS's to the
 * PC, a PC's to OC/2IC/CSM, and OC/2IC/CSM decide anyone's but their own.
 * Nobody decides their own, except an ADMIN (so the app can be tested alone).
 */
function approves(viewer: { personId: string | null; grants: readonly GrantRow[] }, r: Request): boolean {
  if (viewer.personId === r.personId) return holds(viewer.grants, ADMIN) && commandsAt(viewer.grants, r);
  return at(viewer.grants, platoonDecidersFor(r.ownerRoles), r) || companyWide(viewer.grants, COMPANY_DECIDERS);
}

/** A PC's requests (and company HQ's) are decided by OC, 2IC or CSM only: their cards go to COY HQ's chat too. */
export const onlyCompanyDecides = (ownerRoles: readonly WbRole[]) => platoonDecidersFor(ownerRoles).length === 0;

/** Who approves this man's requests, for the Apply screen and a pending record: "your PC or PS", or null when nobody needs to. */
export function approverOf(ownerRoles: readonly WbRole[]): string | null {
  if (ownerRoles.some((r) => COMPANY_DECIDERS.includes(r))) return null;
  const deciders = platoonDecidersFor(ownerRoles);
  if (!deciders.length) return "OC, 2IC or CSM";
  if (deciders.length === 1) return "your PC, OC, 2IC or CSM";
  return "your PC or PS";
}

/** Why this viewer can't decide this request, in words. */
export function decideRefusalText(viewer: { personId: string | null }, r: Request & { subunitName: string }): string {
  if (viewer.personId === r.personId) return "You can't decide your own request. It's with the commander above you.";
  const deciders = platoonDecidersFor(r.ownerRoles);
  if (!deciders.length) return "Only OC, 2IC or CSM can decide this.";
  if (deciders.length === 1) return `Only ${r.subunitName}'s PC, or OC, 2IC or CSM, can decide a PS's request.`;
  return `Only ${r.subunitName}'s PC or PS can decide this.`;
}

// ------------------------------------------------------------------ a record

export interface Viewer {
  id: string;
  personId: string | null;
  grants: readonly GrantRow[];
}

export interface RecordAccess {
  /** role: his platoon's PC or PS, or company command */
  commands: boolean;
  /** role: above the man in the approval chain */
  approves: boolean;
  view: boolean;
  decide: boolean;
  undo: boolean;
  sayWhy: boolean;
  void: boolean;
  withdraw: boolean;
  /** who only: whether this MC is owed is the page's */
  markOnens: boolean;
  /**
   * Who may read a diagnosis or a document photo: the trooper himself, his PC
   * and PS, and OC/2IC/CSM. Not a GC, not another platoon, not an admin.
   * Every read is audited (lib/wb/medical.ts). Who only.
   */
  seeMedical: boolean;
}

/**
 * What this member may do with this record. `hasOutcome`: he's recorded what
 * the doctor gave on this visit, so its approval can only be voided now.
 */
export function recordAccess(viewer: Viewer, r: Request & Decided & { hasOutcome?: boolean }, now: Date = new Date()): RecordAccess {
  const owner = !!viewer.personId && viewer.personId === r.personId;
  const commands = commandsAt(viewer.grants, r);
  const approver = approves(viewer, r);
  return {
    commands,
    approves: approver,
    view: owner || commands,
    decide: r.state === "PENDING" && approver,
    // undo also needs the decider to still command there (2026-10-12)
    undo: commands && !r.hasOutcome && undoRefusal(r, viewer.id, "", now) === null,
    // one reason, never overwritten (2026-10-12; the user, 2026-10-21)
    sayWhy: r.state === "REJECTED" && r.decidedBy === viewer.id && !r.decisionNote,
    void: commands && nextState(r.state, "void") !== null,
    withdraw: owner && nextState(r.state, "withdraw") !== null,
    markOnens: owner || commands,
    seeMedical: owner || commands,
  };
}

/**
 * A visit (an RSI/RSO or MA, or a standalone MC) and what it produced.
 * Recording an outcome is the trooper's own: his commanders read it, they
 * don't write it. Under a visit, only once it's approved (or recorded, for
 * an MA); a standalone one only while it stands.
 */
export function visitAccess(
  viewer: Viewer,
  v: { anchor: VisitRow & Where; parentKind: WbRecordKind | null; outcome: readonly unknown[] },
): { recordOutcome: boolean; seeMedical: boolean; markOnens: boolean } {
  const owner = !!viewer.personId && viewer.personId === v.anchor.personId;
  const ownerOrCommander = owner || commandsAt(viewer.grants, v.anchor);
  return {
    recordOutcome: owner && (v.parentKind ? outcomeParentRefusal(v.anchor, viewer.personId!) === null : v.outcome.length > 0),
    seeMedical: ownerOrCommander,
    markOnens: ownerOrCommander,
  };
}

// ------------------------------------------------------------------ a man, a camp, a post, a platoon

export interface ManAccess {
  /** role: his platoon's PC or PS, or company command (view and void his records) */
  commands: boolean;
  /** send him somewhere (deploy, Assign Extra/RF/SOL), wherever the request is: scope over the man (2026-10-13) */
  sends: boolean;
  /** add an event for him (Add for several men) */
  proxies: boolean;
  /** Remove from roster: his platoon's PC or PS, or OC/2IC/CSM/ADMIN company-wide; never yourself */
  removes: boolean;
  /** Person history */
  history: boolean;
  /** "Back?": his camp's GC, his platoon's PC or PS, or OC/2IC/CSM */
  confirmsBack: boolean;
}

export function manAccess(viewer: { personId?: string | null; grants: readonly GrantRow[] }, man: Where & { personId?: string }): ManAccess {
  const g = viewer.grants;
  const commands = commandsAt(g, man);
  const self = !!viewer.personId && viewer.personId === man.personId;
  const removes = !self && (at(g, PLATOON_REMOVERS, man) || companyWide(g, COMPANY_REMOVERS));
  return {
    commands,
    sends: at(g, RF_ROLES, man),
    proxies: at(g, PROXIES, man) || companyWide(g, COMPANY_DECIDERS),
    removes,
    history: commands || removes,
    confirmsBack: at(g, BACK_ROLES, man),
  };
}

/**
 * A camp (one team). `asks`: raise or close an RF request for it. `forecast`:
 * Manpower for it, for whoever commands there or that very camp's GC (the
 * user, 2026-10-16).
 */
export function campAccess(viewer: { grants: readonly GrantRow[] }, camp: Where): { asks: boolean; forecast: boolean } {
  const g = viewer.grants;
  return {
    asks: at(g, RF_ROLES, camp),
    forecast: commandsAt(g, camp) || at(g, ["GC"], camp),
  };
}

/**
 * A physical camp: its teams share the post. `hoto`: a GC of either team, the
 * platoon's PC/PS, or OC/2IC/CSM. `editShifts`: its pattern and minimum
 * manning, for ADMIN anywhere or the platoon's PC/PS.
 */
export function postAccess(viewer: { grants: readonly GrantRow[] }, post: { subunitId: string; teams: readonly { id: string }[] }): { hoto: boolean; editShifts: boolean } {
  const g = viewer.grants;
  const platoon = { subunitId: post.subunitId };
  return {
    hoto: post.teams.some((t) => at(g, ["GC"], { subunitId: post.subunitId, campId: t.id })) || at(g, PLATOON_DECIDERS, platoon) || companyWide(g, COMPANY_DECIDERS),
    editShifts: holds(g, ADMIN) || at(g, PLATOON_DECIDERS, platoon),
  };
}

/** `linkChat`: /here, its PC or PS (or a company-wide grant), or ADMIN. */
export function platoonAccess(viewer: { grants: readonly GrantRow[] }, subunitId: string): { linkChat: boolean } {
  return { linkChat: at(viewer.grants, PLATOON_DECIDERS, { subunitId }) || holds(viewer.grants, ADMIN) };
}

// ------------------------------------------------------------------ RF

export interface RfAccess {
  /** role: whoever asked, or anyone who could ask for its camp */
  asks: boolean;
  /** the request's page: anyone with an RF role, and whoever asked */
  open: boolean;
  deploy: boolean;
  close: boolean;
  /** Stand down one of the men sent */
  standDown: (man: Where) => boolean;
}

const asksFor = (viewer: { id: string; grants: readonly GrantRow[] }, r: RfRequestView) => r.raisedById === viewer.id || campAccess(viewer, r).asks;

export function rfAccess(viewer: { id: string; grants: readonly GrantRow[] }, r: RfRequestView, now: Date = new Date()): RfAccess {
  const mine = r.raisedById === viewer.id;
  const rf = holds(viewer.grants, RF_ROLES);
  const asks = asksFor(viewer, r);
  return {
    asks,
    open: mine || rf,
    deploy: r.state === "OPEN" && !isOver(r, now) && rf,
    // OPEN only: men already sent stay sent (2026-10-13)
    close: r.state === "OPEN" && asks,
    standDown: (man) => !isOver(r, now) && assignmentAccess(viewer, { man, request: r }).standDown,
  };
}

/** An Extra/RF/SOL: whoever may send him, or (for a request) whoever asked or could ask for its camp. Who only. */
export function assignmentAccess(viewer: { id: string; grants: readonly GrantRow[] }, a: { man: Where; request: RfRequestView | null }): { standDown: boolean } {
  return { standDown: manAccess(viewer, a.man).sends || (!!a.request && asksFor(viewer, a.request)) };
}
