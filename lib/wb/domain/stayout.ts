import { sgtToInstant, toSgt } from "@/lib/parade/time";
import type { AbsenceValues } from "./projection";
import { stayoutData } from "./projection-kinds";
import { onShiftAt, weeklyWant, type ShiftOverride, type ShiftPattern } from "./shifts";
import { addDays, dayMonth } from "./timeline";

// Stay-out on the night parade state (status §3e, A; the user, 2026-10-27).
// A stay-out man is away from 2100 and back at 0600 the next day, only while
// his own camp is on shift. On the parade state he's OTHERS (STAYOUT), with no
// dates, so v1 never calls it overdue and there's no "Back?": it just closes.
// The GC confirms the night at the evening round; a man he marks "staying in"
// isn't put on. Untapped, the night still goes on at 2100. Pure: no I/O.

export const STAYOUT_FROM = "2100";
export const STAYOUT_UNTIL = "0600";

export const WB_STAYOUT_NIGHT_STATES = ["CONFIRMED", "STAYING_IN"] as const;
export type WbStayoutNightState = (typeof WB_STAYOUT_NIGHT_STATES)[number];

/** The night (the date it starts) whose window `now` is in: 2100 to 0600 the next day. Null outside it. */
export function stayoutNight(now: Date): string | null {
  const s = toSgt(now);
  if (s.time >= STAYOUT_FROM) return s.date;
  if (s.time < STAYOUT_UNTIL) return addDays(s.date, -1);
  return null;
}

/** 0600 the morning after: the night's window is over. */
export const nightOver = (night: string, now: Date) => now.getTime() >= sgtToInstant({ date: addDays(night, 1), time: STAYOUT_UNTIL }).getTime();

/** Is he stay-out on this night? Permanent, or temporary up to and including its last day. */
export function onStayout(m: { stayout: "NONE" | "PERM" | "TEMP"; stayoutUntil: string | null }, night: string): boolean {
  return m.stayout === "PERM" || (m.stayout === "TEMP" && !!m.stayoutUntil && m.stayoutUntil >= night);
}

/** What setStatus is sent: OTHERS (STAYOUT), no dates. */
export const STAYOUT_VALUES: AbsenceValues = {
  status: "OTHERS",
  otherReason: "STAYOUT",
  startDate: null,
  startTime: null,
  endDate: null,
  endTime: null,
  maTiming: "",
  maLocation: "",
};

/** Whether a camp will be on at `at`: its weekday pattern (and overrides), its cycle, or else what v1 says now. */
export function campOnAt(p: ShiftPattern | undefined, overrides: readonly ShiftOverride[], v1OnShift: boolean, at: Date): boolean {
  if (!p) return v1OnShift;
  return (p.kind === "WEEKLY" ? weeklyWant(p, overrides, at) : onShiftAt(p, at)) ?? v1OnShift;
}

/** "Permanent" / "until 31/10" for Person history; null when he isn't stay-out today (never, or a date that has passed). */
export function stayoutLabel(m: { stayout: "NONE" | "PERM" | "TEMP"; stayoutUntil: string | null }, today: string): string | null {
  if (!onStayout(m, today)) return null;
  return m.stayout === "PERM" ? "Permanent" : `until ${dayMonth(m.stayoutUntil!)}`;
}

// ------------------------------------------------------------------ the evening message

export interface StayoutMan {
  personId: string;
  rank: string;
  name: string;
  campName: string;
  /** what a commander tapped for this night; null = nothing yet (he goes on at 2100) */
  state: WbStayoutNightState | null;
}

/** Same shape as the Courier's Button: callback data only. */
export interface StayoutButton {
  text: string;
  data: string;
}

/**
 * The platoon's "🏠 Stay-out tonight" message, at the evening round and as
 * every tap redraws it. ✅ Correct while anyone's untapped; one toggle per man.
 */
export function stayoutMessage(m: { subunitId: string; night: string; men: readonly StayoutMan[]; confirmedBy: string | null }): { text: string; buttons: StayoutButton[][] } {
  const out = m.men.filter((x) => x.state !== "STAYING_IN");
  const allConfirmed = out.every((x) => x.state === "CONFIRMED");
  const lines = m.men.map((x) => `• ${x.rank} ${x.name} (${x.campName})${x.state === "STAYING_IN" ? " · 🛏 staying in" : ""}`);
  const text = [
    `🏠 Stay-out tonight ${STAYOUT_FROM}–${STAYOUT_UNTIL} · ${out.length}`,
    "On the parade state from 2100, back at 0600. Tap if anyone's staying in tonight.",
    lines.join("\n"),
    ...(allConfirmed && m.confirmedBy ? [`✅ Confirmed by ${m.confirmedBy}`] : []),
  ].join("\n\n");
  const buttons: StayoutButton[][] = [
    ...(allConfirmed && m.confirmedBy ? [] : [[{ text: "✅ Correct", data: stayoutData(m.subunitId, m.night, "ok") }]]),
    ...m.men.map((x) => [{ text: x.state === "STAYING_IN" ? `🏠 ${x.rank} ${x.name} stays out` : `🛏 ${x.rank} ${x.name} staying in`, data: stayoutData(x.personId, m.night, "in") }]),
  ];
  return { text, buttons };
}
