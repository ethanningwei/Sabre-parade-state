import { ddmmyy } from "@/lib/parade/time";
import type { SnapshotAbsence } from "@/lib/parade/types";
import { roleOf } from "./roles";
import { addDays } from "./timeline";

// A camp's strength list for a conduct (CPT), as the GCs post it in
// Commanders of N23 (docs/conducts-plan.md, the user, 2026-11-02): every man
// by role, each one not going with his reason in brackets, the counts only
// those going. Pure: the page and the tests build the same text.

/** One man as the page gets him: why Sabre thinks he isn't going, if it does. */
export interface StrengthMan {
  personId: string;
  rank: string;
  name: string;
  /** v1's role: "GC", "ST CBT", "MP SPEC", … */
  role: string;
  /** "AL 110826-130826", "MA @CGH": away, from the timeline or the parade state */
  away: string | null;
  /** "LD 180626-190626": a live status. He's there, but not taking part, and not counted (the user, 2026-11-02) */
  status: string | null;
}

/** What the GC tapped for one man: going after all, or not going and why. */
export type StrengthTap = { going: true } | { going: false; reason: string };

/** The reasons a GC picks from; anything else is typed. */
export const TAP_REASONS = ["DRIVING", "MOUNTING", "IPPT", "MA"] as const;

/** Where a man stands once the taps are in. */
export interface StrengthLine {
  man: StrengthMan;
  going: boolean;
  /** what goes in the brackets, or null when he's going */
  reason: string | null;
  /** "auto": Sabre's, "tap": the GC's */
  source: "auto" | "tap" | null;
}

export interface StrengthGroup {
  /** "GC", "CBT", "SVC", or the role as written */
  label: string;
  lines: StrengthLine[];
  going: number;
}

/** "110826", or "110826-130826"; a range ending at midnight ends the day before. */
export function dayRange(start: { date: string } | null, end: { date: string; time: string } | null): string {
  if (!start) return end ? ddmmyy(end.date) : "";
  if (!end) return ddmmyy(start.date);
  const last = end.time === "0000" ? addDays(end.date, -1) : end.date;
  return last <= start.date ? ddmmyy(start.date) : `${ddmmyy(start.date)}-${ddmmyy(last)}`;
}

/** "MC 110826", or just "MC" with no dates. */
export const withRange = (what: string, when: string) => (when ? `${what} ${when}` : what);

/** A status as the lists write it: "LIGHT DUTY" is "LD". */
export function statusReason(label: string, range: string): string {
  const short = label.trim().toUpperCase() === "LIGHT DUTY" ? "LD" : label.trim().toUpperCase();
  return withRange(short, range);
}

/** Whether a parade-state absence covers this moment: v1 keeps one until a GC clears it, ended or not. */
export function v1Covers(a: SnapshotAbsence, now: { date: string; time: string }): boolean {
  if (a.startDate && (a.startDate > now.date || (a.startDate === now.date && a.startTime && a.startTime > now.time))) return false;
  // an end at midnight is the start of that day
  if (a.endDate && (a.endDate < now.date || (a.endDate === now.date && !!a.endTime && (a.endTime === "0000" || a.endTime <= now.time)))) return false;
  return true;
}

/** A parade-state absence as the lists write it. */
export function v1Reason(a: SnapshotAbsence): string {
  const when = a.startDate || a.endDate ? dayRange(a.startDate ? { date: a.startDate } : null, a.endDate ? { date: a.endDate, time: a.endTime ?? "2359" } : null) : "";
  if (a.type === "MA") return a.maLocation ? `MA @${a.maLocation.toUpperCase()}` : "MA";
  if (a.type === "OTHERS") return withRange(a.otherReason.trim().toUpperCase(), when);
  return withRange(a.type, when);
}

const GROUPS: Record<string, string> = { GC: "GC", "ST CBT": "CBT", "ST SVC": "SVC" };

/** The men in role order (GC, CBT, SVC, then any other role as it first appears), roster order within, with the taps applied. */
export function strengthGroups(men: readonly StrengthMan[], taps: Readonly<Record<string, StrengthTap>>): StrengthGroup[] {
  const order = ["GC", "CBT", "SVC"];
  const byLabel = new Map<string, StrengthLine[]>();
  for (const m of men) {
    const role = roleOf(m.role);
    const label = GROUPS[role] ?? (role || "OTHERS");
    if (!order.includes(label)) order.push(label);
    const list = byLabel.get(label) ?? [];
    list.push(lineFor(m, taps[m.personId]));
    byLabel.set(label, list);
  }
  return order.filter((l) => byLabel.has(l)).map((label) => {
    const lines = byLabel.get(label)!;
    return { label, lines, going: lines.filter((l) => l.going).length };
  });
}

function lineFor(man: StrengthMan, tap: StrengthTap | undefined): StrengthLine {
  if (tap) return tap.going ? { man, going: true, reason: null, source: "tap" } : { man, going: false, reason: tap.reason.trim().toUpperCase(), source: "tap" };
  const reason = man.away ?? man.status;
  return reason ? { man, going: false, reason, source: "auto" } : { man, going: true, reason: null, source: null };
}

const pad0 = (n: number) => (n >= 10 ? String(n) : `0${n}`);

/**
 * The message, word for word:
 *
 *   180626 CPT PARTICIPATING STRENGTH
 *
 *   BDK (14/20)
 *
 *   GC: 03/04
 *   1. 3SG JAYVEN
 *   4. 3SG NAZIM (MA @CGH)
 */
export function strengthText(input: { date: string; title: string; campName: string; groups: readonly StrengthGroup[] }): string {
  const going = input.groups.reduce((n, g) => n + g.going, 0);
  const total = input.groups.reduce((n, g) => n + g.lines.length, 0);
  const title = input.title.trim().toUpperCase() || DEFAULT_TITLE;
  const out = [`${ddmmyy(input.date)} ${title}`, "", `${input.campName} (${going}/${total})`];
  for (const g of input.groups) {
    out.push("", `${g.label}: ${pad0(g.going)}/${pad0(g.lines.length)}`);
    g.lines.forEach((l, i) => out.push(`${i + 1}. ${l.man.rank} ${l.man.name}${l.reason ? ` (${l.reason})` : ""}`));
  }
  return out.join("\n");
}

export const DEFAULT_TITLE = "CPT PARTICIPATING STRENGTH";
