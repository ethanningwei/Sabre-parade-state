// The roster flow between the Mini App and the parade state: who is waiting
// to be added, who may add or remove a man, and what removing him does.
// Pure: no I/O.

import { hasGrant, type GrantRow } from "./grants";
import type { WbRole } from "./roles";

/** Gaps, and adding a man from it: the platoon's PS/PC, company command, ASAs and admins. */
export const GAPS_ROLES: readonly WbRole[] = ["PS", "PC", "OC", "2IC", "CSM", "ASA", "ADMIN"];

/**
 * Registered, but not on the parade state and holding no grant: everything in
 * the Mini App needs a roster person, so he gets the waiting screen and nothing
 * else. A grant keeps full access, so an admin can never lock himself out.
 */
export const isWaiting = (m: { registeredAt: Date | null; personId: string | null; grants: readonly unknown[] }) =>
  !!m.registeredAt && !m.personId && m.grants.length === 0;

/** The bot's answer to a quick command from a waiting account. No button: there's nothing he can open yet. */
export const WAITING_REPLY = "You're not on the parade state yet. Your PS can see you on Gaps.";

/** Gaps seen company-wide (true), or only the platoons and camps listed. */
export function gapsReach(grants: readonly GrantRow[]): true | { subunitIds: string[]; campIds: string[] } {
  const mine = grants.filter((g) => GAPS_ROLES.includes(g.role));
  if (mine.some((g) => !g.subunitId && !g.campId)) return true;
  return {
    subunitIds: mine.flatMap((g) => (g.subunitId ? [g.subunitId] : [])),
    campIds: mine.flatMap((g) => (!g.subunitId && g.campId ? [g.campId] : [])),
  };
}

/**
 * Whether a man (by his roster platoon and camp, or what he registered with)
 * is in what these grants see on Gaps: a company-wide grant sees everyone; a
 * platoon grant its platoon; a camp grant its camp. Someone with no camp is
 * company-wide only.
 */
export function inGapsScope(grants: readonly GrantRow[], p: { subunitId: string | null; campId: string | null }): boolean {
  const reach = gapsReach(grants);
  if (reach === true) return true;
  return (!!p.subunitId && reach.subunitIds.includes(p.subunitId)) || (!!p.campId && reach.campIds.includes(p.campId));
}

const PLATOON_REMOVERS: readonly WbRole[] = ["PC", "PS"];
const COMPANY_REMOVERS: readonly WbRole[] = ["OC", "2IC", "CSM", "ADMIN"];

/** Remove from roster: his platoon's PC or PS, or OC/2IC/CSM/ADMIN company-wide. */
export const canRemoveFromRoster = (grants: readonly GrantRow[], where: { subunitId: string; campId: string }) =>
  hasGrant(grants, PLATOON_REMOVERS, where) || hasGrant(grants, COMPANY_REMOVERS, "company");

export function removalRefusal({ self, lastAdmin }: { self: boolean; lastAdmin: boolean }): string | null {
  if (self) return "You can't take yourself off the roster. Ask another commander.";
  if (lastAdmin) return "He's the last Sabre admin. Make someone else an admin first.";
  return null;
}

/** What removing a man will do, counted before he's removed (the confirmation sheet). */
export interface RemovalCounts {
  absences: number;
  duties: number;
  assignments: number;
  pending: number;
  /** "PS · PLATOON 6" */
  grants: string[];
  account: boolean;
  /** approved or recorded entries still to come: kept as history */
  ahead: number;
}

const count = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function removalLines(c: RemovalCounts): { will: string[]; keeps: string[] } {
  const will = ["Off the parade state: never counted again"];
  if (c.absences) will.push(`${count(c.absences, "open absence")} on the parade state closed`);
  if (c.duties) will.push(`${count(c.duties, "Extra/RF/SOL", "Extra/RF/SOL")} on the parade state ended`);
  if (c.assignments) will.push(`${count(c.assignments, "Extra/RF/SOL", "Extra/RF/SOL")} in Sabre stood down`);
  if (c.pending) will.push(`${count(c.pending, "request")} waiting on a decision withdrawn`);
  if (c.grants.length) will.push(`Roles taken away: ${c.grants.join(", ")}`);
  if (c.account) will.push("His Sabre account switched off");
  const keeps = ["His records, as history"];
  if (c.ahead) keeps.unshift(`${count(c.ahead, "approved entry", "approved entries")} still to come (not cancelled)`);
  return { will, keeps };
}

const words = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

/**
 * For "Link to existing": a roster name that might be the man who registered
 * himself. Either contains the other ("TAN" / "TAN AH KOW"), or they share a
 * word of 3 letters or more (one typed his surname, the roster has it first).
 */
export function similarName(typed: string, roster: string): boolean {
  const a = words(typed).join(" ");
  const b = words(roster).join(" ");
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const mine = new Set(words(typed).filter((w) => w.length >= 3));
  return words(roster).some((w) => mine.has(w));
}

/** The DM a man gets once he's on the parade state. */
export const addedText = (where: string) => `✅ You're on the parade state${where ? ` (${where})` : ""}. Open Sabre to report sick, apply for leave and see your records.`;
