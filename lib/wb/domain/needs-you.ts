import type { GridRow } from "./forecast";
import type { WbRole } from "./roles";
import { onlyCompanyDecides } from "./access";
import { dueLabel } from "./named-list";

// Home's "Needs you" card: only what this member should act on, soon, in
// their scope. Pure: no I/O. Agreed with the user 2026-10-16:
//   - one line per kind of problem, never one per man, most urgent first;
//   - hidden when there's nothing (no lines);
//   - never ONENS, Gaps, other platoons' RF requests, or anything that's only news;
//   - v1's blocking issues in their scope (2026-10-17): the parade state can't
//     be generated until they're fixed, so it opens v1's Parade screen;
//   - men waiting for Back (2026-11-06): what ended is still on the parade
//     state, and while Sabre owns it only Back? takes it off;
//   - OC/2IC/CSM count only requests only the company decides, plus any request
//     starting within 48 hours that nobody has decided (the safety net).

export interface NeedLine {
  kind: "short" | "back" | "parade" | "strength" | "names" | "soon" | "approve";
  text: string;
  href: string;
}

export interface NeedsYouInput {
  /** pending requests this member may decide (pendingFor), any order */
  pending: readonly { startAt: Date; ownerRoles: readonly WbRole[] }[];
  /** grid() rows for today and tomorrow, the member's guardrooms only */
  short: readonly GridRow[];
  /** a company decider with no PC/PS grant: platoon-level requests are the PC/PS's */
  companyOnly: boolean;
  now: Date;
  /** YYYY-MM-DD, SGT */
  today: string;
  /** v1's blocking issues in their scope (issuesInScope); 0 or left out for anyone without "Parade state" */
  paradeIssues?: number;
  /** men in his scope whose record or Extra/RF/SOL has ended, waiting for his Back (backFor) */
  back?: number;
  /**
   * what his camps haven't sent (openReportsFor), soonest first: today's
   * conduct strengths, and named lists from set-up to their day
   */
  strengths?: readonly { id: string; campName: string; reportBy: string; kind?: "STRENGTH" | "NAMED"; date?: string; dueDate?: string | null }[];
}

/** A request this close to starting, still undecided, is "soon". */
export const SOON_MS = 48 * 60 * 60 * 1000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "BDK", "BDK, KC3", "BDK +2" */
function campList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
}

export function needsYou({ pending, short, companyOnly, now, today, paradeIssues = 0, back = 0, strengths = [] }: NeedsYouInput): NeedLine[] {
  const lines: NeedLine[] = [];

  // camps below minimum on approved records, by day (off shift and pending-only don't count)
  const days = [...new Set(short.flatMap((r) => r.cells.map((c) => c.date)))].sort();
  const shortDays = days
    .map((date) => ({ date, names: short.filter((r) => r.cells.some((c) => c.date === date && c.on && c.short)).map((r) => r.campName) }))
    .filter((d) => d.names.length);
  if (shortDays.length) {
    const when = (date: string) => (date === today ? "today" : "tomorrow");
    const text = shortDays.map((d, i) => `${campList(d.names)}${i === 0 ? " below minimum" : ""} ${when(d.date)}`).join(" · ");
    lines.push({ kind: "short", text, href: `/tg/manpower?date=${shortDays[0].date}` });
  }

  if (back > 0) lines.push({ kind: "back", text: `${plural(back, "man", "men")} waiting for Back`, href: "/tg/back" });
  if (paradeIssues > 0) lines.push({ kind: "parade", text: `Parade state blocked · ${plural(paradeIssues, "issue")} to fix`, href: "/parade" });

  const whole = strengths.filter((s) => s.kind !== "NAMED");
  if (whole.length) {
    const names = [...new Set(whole.map((s) => s.campName))];
    lines.push({ kind: "strength", text: `Send ${campList(names)} strength · due ${whole[0].reportBy}H`, href: `/tg/conducts/camp/${whole[0].id}` });
  }
  const named = strengths.filter((s) => s.kind === "NAMED");
  if (named.length) {
    const names = [...new Set(named.map((s) => s.campName))];
    const first = named[0];
    lines.push({ kind: "names", text: `Name ${names.length === 1 ? `${names[0]}'s` : campList(names)} men · due ${dueLabel({ date: first.date ?? today, dueDate: first.dueDate ?? null, reportBy: first.reportBy })}`, href: `/tg/conducts/camp/${first.id}` });
  }

  const soon = pending.filter((r) => r.startAt.getTime() - now.getTime() <= SOON_MS);
  const rest = pending.filter((r) => r.startAt.getTime() - now.getTime() > SOON_MS && (!companyOnly || onlyCompanyDecides(r.ownerRoles)));
  if (soon.length) {
    // an undecided request whose start has passed is the most urgent of all: say so
    const started = soon.filter((r) => r.startAt <= now).length;
    const when = started === 0 ? "starting within 48 hours" : started === soon.length ? "already started" : "starting soon or started";
    lines.push({ kind: "soon", text: `${plural(soon.length, "urgent request")} · ${when}`, href: "/tg/inbox" });
  }
  if (rest.length) lines.push({ kind: "approve", text: soon.length ? `${rest.length} more to approve` : `${plural(rest.length, "request")} to approve`, href: "/tg/inbox" });

  return lines;
}
