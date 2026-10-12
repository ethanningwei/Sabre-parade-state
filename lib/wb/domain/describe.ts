import { toSgt } from "@/lib/parade/time";
import { dayMonth, rangeLabel, type Range } from "./timeline";
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
}

/** "AL 27/08–29/08", "MA 27/08 1530H @ NSC", "DV DRIVER COURSE @ MAJU CAMP 27/08–29/08". */
export function recordWhat(r: Describable): string {
  if (r.kind === "MA") return `MA ${dayMonth(toSgt(r.startAt).date)} ${r.maTiming}H @ ${r.location}`;
  if (r.kind === "EVENT") return `${r.detail} ${rangeLabel(r)}`;
  return `${r.kind} ${rangeLabel(r)}`;
}

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
