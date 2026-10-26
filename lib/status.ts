import type { CampState } from "@/lib/parade/compute";
import type { AbsenceType, SnapshotAbsence } from "@/lib/parade/types";
import { ddmmyy } from "@/lib/parade/time";

export const STATUS_LABEL: Record<AbsenceType | "PRESENT", string> = {
  PRESENT: "Present",
  HL: "HL",
  MC: "MC",
  OL: "OL",
  AL: "AL",
  OFF: "Off",
  MA: "MA",
  OTHERS: "Others",
};

export const STATUS_HINT: Record<AbsenceType, string> = {
  HL: "Hospitalisation leave",
  MC: "Medical certificate",
  OL: "Overseas leave",
  AL: "Annual leave",
  OFF: "Off",
  MA: "Medical appointment",
  OTHERS: "Course, engagement, RSO…",
};

/** Short human summary of an absence, for chips and lists. */
export function absenceSummary(a: SnapshotAbsence): string {
  if (a.type === "MA") return `MA ${a.maTiming}H${a.maLocation ? ` @ ${a.maLocation}` : ""}`;
  const label = a.type === "OTHERS" ? a.otherReason.trim() || "Others" : a.type;
  if (a.startDate && a.endDate) {
    const s = ddmmyy(a.startDate) + (a.startTime ? ` ${a.startTime}` : "");
    const e = ddmmyy(a.endDate) + (a.endTime ? ` ${a.endTime}` : "");
    return `${label} · ${s} – ${e}`;
  }
  return label;
}

/**
 * How the strength bars and the dial group a camp's men, one colour each.
 * Off shift is the whole of an off-shift camp; the rest are on-shift men.
 */
export type StrengthPart = "present" | "offshift" | "leave" | "medical" | "others";
export const STRENGTH_PARTS: readonly StrengthPart[] = ["present", "offshift", "leave", "medical", "others"];

export const STATUS_PART: Record<AbsenceType, "leave" | "medical" | "others"> = {
  HL: "medical",
  MC: "medical",
  MA: "medical",
  OL: "leave",
  AL: "leave",
  OFF: "leave",
  OTHERS: "others",
};

export const PART_LABEL: Record<StrengthPart, string> = {
  present: "Present",
  offshift: "Off shift",
  leave: "Leave and off",
  medical: "Medical",
  others: "Others",
};

export interface Strength {
  /** the men of these camps, by part; sums to `total` */
  parts: Record<StrengthPart, number>;
  total: number;
  /** Extra/RF/SOL counted at these camps, on top of `parts.present` */
  duties: number;
}

/** Splits camps' men into parts. `parts.present + duties` is the present strength (HQ never counts duties). */
export function strengthOf(camps: readonly CampState[], isHq = false): Strength {
  const parts: Record<StrengthPart, number> = { present: 0, offshift: 0, leave: 0, medical: 0, others: 0 };
  let total = 0;
  let duties = 0;
  for (const c of camps) {
    total += c.total;
    if (!c.onShift) {
      parts.offshift += c.total;
      continue;
    }
    parts.present += c.total - c.absentees.length;
    for (const p of c.absentees) parts[STATUS_PART[p.absence!.type]]++;
    if (!isHq) duties += c.duties.EXTRA.length + c.duties.RF.length + c.duties.SOL.length;
  }
  return { parts, total, duties };
}

/** Adds strengths together (the coy from its subunits). */
export function addStrengths(list: readonly Strength[]): Strength {
  const parts: Record<StrengthPart, number> = { present: 0, offshift: 0, leave: 0, medical: 0, others: 0 };
  for (const s of list) for (const k of STRENGTH_PARTS) parts[k] += s.parts[k];
  return { parts, total: list.reduce((n, s) => n + s.total, 0), duties: list.reduce((n, s) => n + s.duties, 0) };
}
