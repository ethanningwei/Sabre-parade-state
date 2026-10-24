// ROT (rotational training) and the changeover from Ops Vigilance: the pure
// rules (docs/phases-plan.md §2–§3). No I/O.
//
// The ROT structure is v1 rows, never v1 schema: each platoon is a `subunit`
// row and each section a `camp` row, always on shift. A section's camp is
// named "<platoon> <section>" ("PLATOON 1 SECTION 1") because v1 camp names
// are unique in a coy; everything that prints it shows "SECTION 1".

/** A company's phase (wb_phase). No row = Vigilance. */
export const PHASES = ["VIGILANCE", "ROT"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = { VIGILANCE: "Ops Vigilance", ROT: "ROT" };

/** The v1 camp name of a section: unique within the coy. */
export const sectionCampName = (platoon: string, section: string) => `${platoon} ${section}`;

/** "PLATOON 1 SECTION 1" in "PLATOON 1" → "SECTION 1". Any other camp keeps its name. */
export function sectionLabel(campName: string, subunitName: string): string {
  const prefix = `${subunitName} `;
  return campName.startsWith(prefix) && campName.length > prefix.length ? campName.slice(prefix.length) : campName;
}

/** A name for a platoon or section as typed: trimmed, single-spaced, upper case. */
export function cleanName(raw: string): string {
  return raw.trim().split(/\s+/).filter(Boolean).join(" ").toUpperCase();
}

// ------------------------------------------------------------------ the changeover log

/** A grant as it was, to put back. */
export interface LoggedGrant {
  memberId: string;
  role: string;
  subunitId: string | null;
  campId: string | null;
  grantedBy: string | null;
  grantedAt: string;
}

/** A man moved into his section: where he was, so Switch back puts him back exactly. */
export interface LoggedMove {
  personId: string;
  fromCampId: string;
  toCampId: string;
  role: string;
  toRole: string;
  sortOrder: number;
}

/** An SVC trooper taken off the roster by the switch, and what went with him. */
export interface LoggedRemoval {
  personId: string;
  /** his v1 absences the removal closed (an MC, leave) */
  absenceIds: string[];
  /** his open v1 duties, and their "RF @ X" home absences */
  dutyIds: string[];
  dutyAbsenceIds: string[];
  /** his Extra/RF/SOL in Sabre */
  assignmentIds: string[];
  /** his requests withdrawn */
  recordIds: string[];
  /** his account, if any, and whether it was on */
  memberId: string | null;
  memberActive: boolean;
  grants: LoggedGrant[];
  /** projector rows closed */
  projectionIds: string[];
}

/** What one Switch to ROT did (wb_changeover.log). */
export interface ChangeoverLog {
  /** v1 rows the switch created; Switch back deletes them */
  subunits: string[];
  camps: string[];
  /** Vigilance camps and platoons left out of the ROT parade state (kept as history) */
  hiddenCamps: string[];
  hiddenSubunits: string[];
  moves: LoggedMove[];
  /** grants replaced (GC, platoon PC/PS) and the drafted ones added */
  grantsRemoved: LoggedGrant[];
  grantsAdded: string[];
  /** live Extra/RF/SOL ended: Sabre's assignments, v1's duties and their home absences */
  assignments: string[];
  duties: string[];
  dutyAbsences: string[];
  /** SVC troopers removed, one Write each */
  removed: LoggedRemoval[];
  /** drafted commanders who had no account, so got no grant */
  unregistered: string[];
}

export const emptyLog = (): ChangeoverLog => ({
  subunits: [],
  camps: [],
  hiddenCamps: [],
  hiddenSubunits: [],
  moves: [],
  grantsRemoved: [],
  grantsAdded: [],
  assignments: [],
  duties: [],
  dutyAbsences: [],
  removed: [],
  unregistered: [],
});
