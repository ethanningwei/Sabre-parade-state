import { toSgt } from "@/lib/parade/time";
import { datesLabel, dayCount, dayMonth, rangeLabel, type Range } from "./timeline";
import type { WbRecordKind, WbRecordState } from "./rules";

// How a record reads, everywhere one is shown: cards, My records, the clash
// warning. Pure, so client components can use it too.

export const KIND_LABEL: Record<WbRecordKind, string> = {
  RSI: "Report sick (in camp)",
  RSO: "Report sick (outside)",
  MC: "MC",
  HL: "Hospitalisation leave",
  STATUS: "Status",
  MA: "Medical appointment",
  AL: "Annual leave",
  OL: "Overseas leave",
  OFF: "Off",
  EVENT: "Event",
};

export const STATE_LABEL: Record<WbRecordState, string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECORDED: "recorded",
  CANCELLED: "voided",
  WITHDRAWN: "withdrawn",
};

export const STATE_ICON: Record<WbRecordState, string> = {
  PENDING: "⏳",
  APPROVED: "✅",
  REJECTED: "❌",
  RECORDED: "📝",
  CANCELLED: "🚫",
  WITHDRAWN: "↩️",
};

export interface Describable extends Range {
  kind: WbRecordKind;
  detail: string;
  location: string;
  maTiming: string | null;
  /** MC/HL only. Never the diagnosis: this line goes on group cards. */
  mcCategory?: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "AL 27/08–29/08", "MA 27/08 1530H @ NSC", "DV DRIVER COURSE @ MAJU CAMP 27/08–29/08",
 * "RSO 14/10 @ RAFFLES MEDICAL", "MC 3 days · 14/10–16/10 · Respiratory",
 * "LIGHT DUTY 17/10–20/10", "EXCUSE RMJ from 17/10 (permanent)".
 *
 * Safe for a group chat: an MC carries its category, never its diagnosis.
 */
export function recordWhat(r: Describable): string {
  switch (r.kind) {
    case "MA":
      return `MA ${dayMonth(toSgt(r.startAt).date)} ${r.maTiming}H @ ${r.location}`;
    case "EVENT":
      return `${r.detail} ${datesLabel(r)}`;
    case "RSI":
      return `RSI ${datesLabel(r)}`;
    case "RSO":
      return `RSO ${datesLabel(r)}${r.location ? ` @ ${r.location}` : ""}`;
    case "MC":
    case "HL":
      return [`${r.kind} ${plural(dayCount(r), "day")}`, datesLabel(r), r.mcCategory].filter(Boolean).join(" · ");
    case "STATUS":
      return `${r.detail} ${datesLabel(r)}${r.endAt ? "" : " (permanent)"}`;
    default:
      return `${r.kind} ${rangeLabel(r)}`;
  }
}

/** "Respiratory", or "Other" for anything typed: what the company counts. */
export function mcCategoryOf(chosen: string): string {
  return chosen === "OTHER" ? "Other" : chosen;
}

/** A status as the paper says it: a listed one, or what he typed, upper case. */
export const statusLabel = (type: string, other: string) => (type === "OTHER" ? other.trim().toUpperCase() : type);

/** "AL 27/08–29/08 · approved": the clash warning's line. */
export const recordLine = (r: Describable & { state: WbRecordState }) => `${recordWhat(r)} · ${STATE_LABEL[r.state]}`;

/** "BANGKOK, THAILAND": overseas leave carries a city, because "Malaysia" isn't where to reach someone. */
export function overseasWhere(city: string, country: string): string {
  const c = city.trim();
  const k = country.trim();
  return (c && k ? `${c}, ${k}` : c || k).toUpperCase();
}

/** "AL @ JOHOR BAHRU" */
export const leaveDetail = (kind: "AL" | "OL", where: string) => `${kind} @ ${where.toUpperCase()}`;

/**
 * The event's line as the parade state will print it: "DV DRIVER COURSE @ MAJU
 * CAMP", with the daily hours unless it's the whole day ("0800-1700H"). A
 * course entered by the trooper and the same course entered by his PS must
 * read the same.
 */
export function eventDetail(what: string, place: string, timeStart: string, timeEnd: string): string {
  const hours = timeStart === "0000" && timeEnd === "2359" ? "" : ` ${timeStart}-${timeEnd}H`;
  return `${what.trim().toUpperCase()} @ ${place.trim().toUpperCase()}${hours}`;
}

/** "Holiday", or what they typed. */
export const reasonText = (reason: string, other: string) => (reason === "OTHER" ? other.trim() : reason);

/** An outcome reads MC/HL first, then its statuses by start. */
export const outcomeOrder = <R extends { kind: string; startAt: Date; detail: string }>(rows: R[]): R[] =>
  rows.sort(
    (a, b) =>
      (a.kind === "STATUS" ? 1 : 0) - (b.kind === "STATUS" ? 1 : 0) ||
      a.startAt.getTime() - b.startAt.getTime() ||
      // same day: by name, so a card reads the same every time it's redrawn
      a.detail.localeCompare(b.detail),
  );
