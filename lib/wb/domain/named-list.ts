import { ddmmyy, sgtToInstant } from "@/lib/parade/time";
import { onShiftAt, type ShiftPattern } from "./shifts";
import { groupLabel } from "./strength-list";

// Named lists (slice 3 of docs/conducts-plan.md, the user, 2026-11-03): OSE,
// comd training and IPPT. Each camp's GC names who's going, and Sabre keeps
// one coy list in Commanders of N23 in the template the chat already uses:
// the title, the team, "Participants", the total, then each platoon's count
// and its camps with their names. A camp still waiting has a blank heading; a
// camp that named nobody says NIL, as the GCs write it. Pure: the cores, pages
// and tests share it.

export const NAMED_TITLE = "OSE & COMD TRAINING";

export const TEAMS = ["A", "B"] as const;
export type Team = (typeof TEAMS)[number];

/** A camp as set-up sees it: its physical camp (`post`) pairs SFT A with SFT B. */
export interface SetUpCamp {
  id: string;
  name: string;
  post: string;
  subunitId: string;
  isHq: boolean;
}

const pairsOf = (camps: readonly SetUpCamp[]) => {
  const posts = new Map<string, SetUpCamp[]>();
  for (const c of camps) {
    if (c.isHq) continue;
    const key = `${c.subunitId}:${c.post}`;
    posts.set(key, [...(posts.get(key) ?? []), c]);
  }
  return [...posts.values()];
};

/**
 * The camps ticked to start with: every camp with no partner team, and of
 * each pair (SFT A/B) the team off shift at midday that day. HQ never. A pair
 * with no patterns, or both off, is left for the PS to tick.
 */
export function namedPreTicked(camps: readonly SetUpCamp[], patterns: ReadonlyMap<string, ShiftPattern>, date: string): string[] {
  const noon = sgtToInstant({ date, time: "1200" });
  const ids = new Set<string>();
  for (const teams of pairsOf(camps)) {
    if (teams.length === 1) {
      ids.add(teams[0].id);
      continue;
    }
    const off = teams.filter((c) => {
      const p = patterns.get(c.id);
      return !!p && onShiftAt(p, noon) === false;
    });
    if (off.length === 1) ids.add(off[0].id);
  }
  return camps.filter((c) => ids.has(c.id)).map((c) => c.id);
}

/** "SFT A" is team A. */
export function teamOf(campName: string): Team | null {
  const last = campName.trim().split(/\s+/).at(-1)?.toUpperCase();
  return last === "A" || last === "B" ? last : null;
}

/** The "(Team A)" line to start with: the team most of the ticked pairs' camps belong to; none on a tie. */
export function teamFor(camps: readonly SetUpCamp[], ticked: readonly string[]): Team | null {
  const paired = new Set(pairsOf(camps).filter((t) => t.length > 1).flat().map((c) => c.id));
  const count = { A: 0, B: 0 };
  for (const c of camps) {
    const t = paired.has(c.id) && ticked.includes(c.id) ? teamOf(c.name) : null;
    if (t) count[t]++;
  }
  return count.A > count.B ? "A" : count.B > count.A ? "B" : null;
}

/** "PLATOON 5" is "Plt 5", as the lists write it. */
export function plt(subunitName: string): string {
  const m = /^PLATOON\s*(\d+)$/i.exec(subunitName.trim());
  return m ? `Plt ${m[1]}` : subunitName.trim();
}

/** The men in the lists' order: GC, CBT, SVC, then any other role as it first appears; roster order within. */
export function byRole<T extends { role: string }>(men: readonly T[]): T[] {
  const order = ["GC", "CBT", "SVC"];
  for (const m of men) {
    const l = groupLabel(m.role);
    if (!order.includes(l)) order.push(l);
  }
  return [...men].sort((a, b) => order.indexOf(groupLabel(a.role)) - order.indexOf(groupLabel(b.role)));
}

export interface NamedCamp {
  name: string;
  /** false: still waiting, a blank heading */
  sent: boolean;
  /** the men named, in the lists' order */
  men: readonly { rank: string; name: string }[];
}

export interface NamedPlatoon {
  /** the subunit's name, "PLATOON 5" */
  name: string;
  camps: readonly NamedCamp[];
}

/** "3SG ILYAS": a roster name can carry a stray space. */
export const manLine = (m: { rank: string; name: string }) => `${m.rank.trim()} ${m.name.trim()}`;

const countOf = (camps: readonly NamedCamp[]) => (camps.some((c) => c.sent) ? ` ${camps.reduce((n, c) => n + c.men.length, 0)}` : "");

/**
 * The coy list, word for word:
 *
 *   120826 OSE & COMD TRAINING
 *   (Team A)
 *
 *   Participants
 *
 *   Total Strength: 21
 *
 *   Plt 5: 6
 *
 *   HDN:
 *   LCP CASEY
 *
 *   TFT:
 *   NIL
 */
export function namedListText(input: { date: string; title: string; team: string | null; platoons: readonly NamedPlatoon[] }): string {
  const title = input.title.trim().toUpperCase() || NAMED_TITLE;
  const out = [`${ddmmyy(input.date)} ${title}`];
  if (input.team) out.push(`(Team ${input.team})`);
  out.push("", "Participants", "", `Total Strength:${countOf(input.platoons.flatMap((p) => p.camps))}`);
  for (const p of input.platoons) {
    out.push("", `${plt(p.name)}:${countOf(p.camps)}`);
    for (const c of p.camps) {
      out.push("", `${c.name}:`);
      if (c.sent) out.push(...(c.men.length ? c.men.map(manLine) : ["NIL"]));
    }
  }
  return out.join("\n");
}

/** "110826 1800H": when the names are due. */
export const dueLabel = (c: { date: string; dueDate: string | null; reportBy: string }) => `${ddmmyy(c.dueDate ?? c.date)} ${c.reportBy}H`;

/** The DM a camp's GC gets, at set-up and on a nudge. */
export function namedAskText(c: { title: string; date: string; team: string | null; dueDate: string | null; reportBy: string }, campName: string, nudge = false): string {
  const head = nudge ? "⏰ Still waiting for" : "📋 Name";
  const team = c.team ? ` (Team ${c.team})` : "";
  return `${head} ${campName}'s men for ${ddmmyy(c.date)} ${c.title}${team}, by ${dueLabel(c)}.\nTap below, tick who's going, then Send: it goes on the coy list in Commanders of N23.`;
}
