import { z } from "zod";
import { ddmmyy, toSgt } from "@/lib/parade/time";
import { onDay, type ShiftPattern } from "./shifts";
import { addDays } from "./timeline";
import { NAMED_TITLE, TEAMS } from "./named-list";
import { DEFAULT_TITLE } from "./strength-list";

// Conducts (slice 2 of docs/conducts-plan.md): a PS or above sets one up for
// some camps, each camp's GC sends its strength, and the bot posts it into
// Commanders of N23 (the user, 2026-11-02). Whole camps only; nothing here
// touches the parade state. Pure: the cores, pages and tests share it.

export const CONDUCT_STATES = ["OPEN", "CANCELLED"] as const;
export type ConductState = (typeof CONDUCT_STATES)[number];

/** STRENGTH: whole camps (CPT, slice 2). NAMED: each GC names who's going (OSE, comd training, IPPT, slice 3). */
export const CONDUCT_KINDS = ["STRENGTH", "NAMED"] as const;
export type ConductKind = (typeof CONDUCT_KINDS)[number];

/** Chats that belong to the coy rather than a platoon, linked with `/here COMMANDERS`. */
export const COY_CHAT_KINDS = ["COMMANDERS"] as const;
export type CoyChatKind = (typeof COY_CHAT_KINDS)[number];

/** What each kind is called on screen. */
export const COY_CHAT_LABEL: Record<CoyChatKind, string> = { COMMANDERS: "Commanders of N23" };

/** One nudge per camp per 10 minutes. */
export const NUDGE_GAP_MS = 10 * 60 * 1000;

/** How far ahead a conduct can be set up. */
export const AHEAD_DAYS = 7;

/** The camps ticked to start with: those off shift that day (the ones that go). HQ never. */
export function preTicked(camps: readonly { id: string; isHq: boolean }[], patterns: ReadonlyMap<string, ShiftPattern>, date: string): string[] {
  return camps.filter((c) => {
    if (c.isHq) return false;
    const p = patterns.get(c.id);
    return !!p && onDay(p, date) === false;
  }).map((c) => c.id);
}

export const canNudge = (nudgedAt: Date | null, now: Date) => !nudgedAt || now.getTime() - nudgedAt.getTime() >= NUDGE_GAP_MS;

/** "1912H" */
export const hhmmH = (at: Date) => `${toSgt(at).time}H`;

/** The camp's message after a second send: the same post, edited, says so. */
export const updatedText = (text: string, at: Date) => `${text}\n\nUpdated ${hhmmH(at)}`;

/** A named list's post once the conduct is cancelled. */
export const cancelledText = (text: string, at: Date) => `${text}\n\n❌ Cancelled ${hhmmH(at)}`;

/** The DM a camp's GC gets, at set-up and on a nudge. */
export function askText(c: { title: string; date: string; reportBy: string }, campName: string, nudge = false): string {
  const head = nudge ? "⏰ Still waiting for" : "📋 Send";
  return `${head} ${campName}'s strength for ${ddmmyy(c.date)} ${c.title}, by ${c.reportBy}H.\nTap below, check the list, then Send: it goes into Commanders of N23.`;
}

/** What one camp sent, as the roll-up reads it. */
export interface CampReport {
  campId: string;
  campName: string;
  /** null: not sent yet */
  reportedAt: Date | null;
  reportedBy: string | null;
  going: number;
  total: number;
  nudgedAt: Date | null;
  men: readonly { rank: string; name: string; role: string; going: boolean; reason: string | null }[];
}

export interface RollUp {
  sent: number;
  camps: number;
  going: number;
  total: number;
  /** coy totals by role, as the camps' messages group them */
  byRole: { label: string; going: number; total: number }[];
  /** the men not going, camp by camp */
  out: { campName: string; rank: string; name: string; reason: string }[];
}

/** Totals over the camps that have sent. A camp still waiting counts for nothing. */
export function rollUp(camps: readonly CampReport[], groupOf: (role: string) => string): RollUp {
  const sent = camps.filter((c) => c.reportedAt);
  const roles = new Map<string, { going: number; total: number }>();
  const order = ["GC", "CBT", "SVC"];
  const out: RollUp["out"] = [];
  for (const c of sent) {
    for (const m of c.men) {
      const label = groupOf(m.role);
      if (!order.includes(label)) order.push(label);
      const r = roles.get(label) ?? { going: 0, total: 0 };
      r.total++;
      if (m.going) r.going++;
      roles.set(label, r);
      if (!m.going) out.push({ campName: c.campName, rank: m.rank, name: m.name, reason: m.reason ?? "" });
    }
  }
  return {
    sent: sent.length,
    camps: camps.length,
    going: sent.reduce((n, c) => n + c.going, 0),
    total: sent.reduce((n, c) => n + c.total, 0),
    byRole: order.filter((l) => roles.has(l)).map((label) => ({ label, ...roles.get(label)! })),
    out,
  };
}

/**
 * The coy total, for the PS to copy (the app only: nothing extra goes into
 * the chat, the user, 2026-11-02):
 *
 *   021126 CPT PARTICIPATING STRENGTH
 *   TOTAL: 74/86
 *
 *   BDK: 14/20
 *   TFT: not reported
 */
export function coyTotalText(c: { title: string; date: string }, camps: readonly CampReport[]): string {
  const r = rollUp(camps, (x) => x);
  const lines = camps.map((x) => `${x.campName}: ${x.reportedAt ? `${x.going}/${x.total}` : "not reported"}`);
  return [`${ddmmyy(c.date)} ${c.title}`, `TOTAL: ${r.going}/${r.total}`, "", ...lines].join("\n");
}

const hhmm = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, "Report by is a time like 1830");

/**
 * The set-up form. `today` bounds the date: today to a week ahead. A named
 * list's names are due by a day from today to the conduct's day (the day
 * before by default, or the day itself when that's today); a strength's are
 * due on the day, and it has no team.
 */
export function conductInput(today: string) {
  return z
    .object({
      kind: z.enum(CONDUCT_KINDS).default("STRENGTH"),
      title: z
        .string()
        .trim()
        .transform((s) => s.toUpperCase())
        .pipe(z.string().max(80, "Keep the conduct's name under 80 characters")),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((d) => d >= today, "That date has passed")
        .refine((d) => d <= addDays(today, AHEAD_DAYS), `Set it up at most ${AHEAD_DAYS} days ahead`),
      team: z.enum(TEAMS).nullable().default(null),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .default(null),
      reportBy: hhmm,
      campIds: z.array(z.uuid()).min(1, "Tick at least one camp"),
    })
    .transform((v) => {
      const named = v.kind === "NAMED";
      return {
        ...v,
        title: v.title || (named ? NAMED_TITLE : DEFAULT_TITLE),
        team: named ? v.team : null,
        dueDate: named ? (v.dueDate ?? (v.date > today ? addDays(v.date, -1) : v.date)) : null,
      };
    })
    .refine((v) => v.dueDate === null || (v.dueDate >= today && v.dueDate <= v.date), { message: "Names are due between today and the conduct's day", path: ["dueDate"] });
}
export type ConductInput = z.output<ReturnType<typeof conductInput>>;
