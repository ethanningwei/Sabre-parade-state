import type { GridRow } from "./forecast";
import type { WbRole } from "./roles";
import { onlyCompanyDecides } from "./rules";

// Home's "Needs you" card: only what this member should act on, soon, in
// their scope. Pure: no I/O. Agreed with the user 2026-10-16:
//   - one line per kind of problem, never one per man, most urgent first;
//   - hidden when there's nothing (no lines);
//   - never ONENS, Gaps, other platoons' RF requests, or anything that's only news;
//   - OC/2IC/CSM count only requests only the company decides, plus any request
//     starting within 48 hours that nobody has decided (the safety net).

export interface NeedLine {
  kind: "short" | "soon" | "approve";
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
}

/** A request this close to starting, still undecided, is "soon". */
export const SOON_MS = 48 * 60 * 60 * 1000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "BDK", "BDK, KC3", "BDK +2" */
function campList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
}

export function needsYou({ pending, short, companyOnly, now, today }: NeedsYouInput): NeedLine[] {
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
