import { recordLine, type Describable } from "./describe";
import { isLive, type WbRecordState } from "./rules";
import { addDays, overlaps, rangeLabel, type Range } from "./timeline";
import { sgtToInstant } from "@/lib/parade/time";

// "You already have something on those days." Never a refusal: an MA during
// an MC is perfectly ordinary, and a rule clever enough to tell that from a
// genuine mistake would be wrong in both directions. He's shown it and decides.

export interface ClashRecord extends Describable {
  state: WbRecordState;
  absent: boolean;
}

/** An open v1 duty for this person (read-only). Dates and times are optional, as in v1. */
export interface ClashDuty {
  type: "EXTRA" | "RF" | "SOL";
  campName: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}

/** v1's reading of a duty's dates: missing = open; a date-only end lasts the whole day. */
export function dutyRange(d: ClashDuty): Range {
  const startAt = d.startDate ? sgtToInstant({ date: d.startDate, time: d.startTime ?? "0000" }) : new Date(0);
  const endAt = !d.endDate
    ? null
    : d.endTime
      ? sgtToInstant({ date: d.endDate, time: d.endTime })
      : sgtToInstant({ date: addDays(d.endDate, 1), time: "0000" });
  return { startAt, endAt };
}

/** A live wb_assignment (Phase 5): Extra/RF/SOL he's already down for. */
export interface ClashAssignment extends Range {
  type: "EXTRA" | "RF" | "SOL";
  campName: string;
}

const ASSIGNED: Record<ClashAssignment["type"], string> = { EXTRA: "Extra", RF: "RF", SOL: "SOL" };

/** The lines to show, oldest first. Empty means nothing in the way. */
export function clashLines(range: Range, records: readonly ClashRecord[], duties: readonly ClashDuty[], assignments: readonly ClashAssignment[] = []): string[] {
  const recs = records
    .filter((r) => r.absent && isLive(r.state) && overlaps(range, r))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map(recordLine);
  const dut = duties
    .map((d) => ({ d, r: dutyRange(d) }))
    .filter(({ r }) => overlaps(range, r))
    .map(({ d, r }) => `${d.type} @ ${d.campName}${d.startDate ? ` ${rangeLabel(r)}` : ""}`);
  const asg = assignments
    .filter((a) => overlaps(range, a))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((a) => `${ASSIGNED[a.type]} @ ${a.campName} ${rangeLabel(a)}`);
  return [...recs, ...dut, ...asg];
}
