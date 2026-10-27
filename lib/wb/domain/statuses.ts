import { toSgt } from "@/lib/parade/time";
import { addDays, dayMonth, todaySgt } from "./timeline";
import { STANDING_STATES, VISIT_KINDS, type WbRecordKind, type WbRecordState } from "./rules";

// A man's statuses as their own list (2026-10-27): what he's on now, and what's
// over. Shown only on his own pages (Person history, My records), apart from
// his other records, and never on Manpower. Pure, so it's tested without a DB.

export interface StatusRow {
  id: string;
  parentId: string | null;
  kind: WbRecordKind;
  state: WbRecordState;
  startAt: Date;
  /** null = permanent */
  endAt: Date | null;
  detail: string;
  createdVia: string;
  decisionNote: string | null;
}

export interface StatusItem {
  id: string;
  /** "LIGHT DUTY", "EXCUSE RMJ" */
  label: string;
  permanent: boolean;
  /** 'YYYY-MM-DD', the first day */
  from: string;
  /** 'YYYY-MM-DD', the last day; null when permanent */
  until: string | null;
  /** days after today up to the last day: 27/10 until 03/11 is 7. 0 = ends today */
  daysLeft: number | null;
  /** still running and its last day is today or tomorrow */
  endsSoon: boolean;
  /** hasn't started yet */
  upcoming: boolean;
  voided: boolean;
  /** "From RSI 27/10", "Declared by him", "Recorded by him" */
  source: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * His statuses, given all his records (parents are looked up among them).
 * Live: standing and not over, permanent first, then the soonest to end.
 * Past: over or voided, newest first. A corrected row is left out: the
 * correction re-recorded it, so it's already here as the new row.
 */
export function statusesOf<R extends StatusRow>(records: readonly R[], now: Date): { live: StatusItem[]; past: StatusItem[] } {
  const byId = new Map(records.map((r) => [r.id, r]));
  const today = todaySgt(now);
  const live: StatusItem[] = [];
  const past: StatusItem[] = [];
  for (const r of records) {
    if (r.kind !== "STATUS") continue;
    if (r.state === "CANCELLED" && r.decisionNote?.startsWith("Corrected by")) continue;
    const standing = STANDING_STATES.includes(r.state);
    if (!standing && r.state !== "CANCELLED") continue;
    const over = r.endAt !== null && r.endAt.getTime() <= now.getTime();
    const until = r.endAt ? toSgt(new Date(r.endAt.getTime() - 1)).date : null;
    const from = toSgt(r.startAt).date;
    const running = standing && !over;
    const item: StatusItem = {
      id: r.id,
      label: r.detail || "STATUS",
      permanent: r.endAt === null,
      from,
      until,
      daysLeft: until ? daysBetween(today, until) : null,
      endsSoon: running && !!until && until <= addDays(today, 1),
      upcoming: from > today,
      voided: r.state === "CANCELLED",
      source: sourceOf(r, byId),
    };
    (running ? live : past).push(item);
  }
  live.sort((a, b) => (a.permanent !== b.permanent ? (a.permanent ? -1 : 1) : a.permanent ? a.from.localeCompare(b.from) : a.until!.localeCompare(b.until!)));
  return { live, past };
}

/** Where a status came from: the visit it was given at, or him. */
function sourceOf(r: StatusRow, byId: ReadonlyMap<string, StatusRow>): string {
  const parent = r.parentId ? byId.get(r.parentId) : undefined;
  if (parent && VISIT_KINDS.includes(parent.kind)) return `From ${parent.kind} ${dayMonth(toSgt(parent.startAt).date)}`;
  return r.createdVia === "DECLARED" ? "Declared by him" : "Recorded by him";
}
