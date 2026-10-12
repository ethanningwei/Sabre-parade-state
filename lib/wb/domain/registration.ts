// Registration rules, ported from Sabre Bot (flows.py REGISTER, engine.py
// validate / _after_match_name / _after_pick_man). Pure: no I/O.

import { parseDdmmyy } from "@/lib/parade/time";

export const TAKEN_MESSAGE =
  "That name is already registered to another Telegram account. Ask your PS to sort it out.";

/** More candidates than this and we ask for more of the name instead of listing them. */
export const PICK_MAX = 6;

export interface Candidate {
  personId: string;
  name: string;
  /** wb_member.id already linked to this person, if any */
  linkedMemberId: string | null;
}

export type MatchResult<C extends Candidate> =
  | { kind: "none" }
  | { kind: "too-many"; count: number }
  | { kind: "one"; person: C }
  | { kind: "pick"; people: C[] };

/**
 * Exact (case-insensitive) first, then contains, so "CHUN" offers both
 * CHUN HEI and CHUN WEI rather than guessing. `pool` is active roster people.
 * People already linked to someone are still matched, so the trooper is told
 * why he can't have that name rather than being told he isn't on the roster.
 */
export function matchName<C extends Candidate>(query: string, pool: readonly C[]): MatchResult<C> {
  const q = query.trim().toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  if (!q) return { kind: "none" };
  const exact = pool.filter((p) => p.name.toUpperCase() === q);
  const hits = exact.length ? exact : pool.filter((p) => p.name.toUpperCase().includes(q));
  if (!hits.length) return { kind: "none" };
  if (hits.length > PICK_MAX) return { kind: "too-many", count: hits.length };
  if (hits.length === 1) return { kind: "one", person: hits[0] };
  return { kind: "pick", people: hits };
}

/** Linked to another account: one account, one profile. His own link is fine (re-registering). */
export const linkedToSomeoneElse = (c: Candidate, memberId: string) =>
  c.linkedMemberId !== null && c.linkedMemberId !== memberId;

/**
 * The last 4 of an NRIC (3 digits and a letter). A whole NRIC typed by
 * mistake is cut down to its last 4, so the rest is never stored.
 */
export function nric4(raw: string): string | null {
  const n = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(-4);
  return /^\d{3}[A-Z]$/.test(n) ? n : null;
}

/** DDMMYY (slashes, dashes, dots and spaces allowed) -> YYYY-MM-DD, or null. */
export function ddmmyy(raw: string): string | null {
  return parseDdmmyy(raw.replace(/\D/g, ""));
}

/** A plain number of leave days, 0–999. */
export function leaveDays(raw: string): number | null {
  const d = raw.replace(/\D/g, "");
  if (!d || d.length > 3) return null;
  return Number(d);
}
