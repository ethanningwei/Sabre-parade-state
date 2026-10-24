// ROT (rotational training) and the changeover from Ops Vigilance: the pure
// rules (docs/phases-plan.md §2–§3). No I/O.
//
// The ROT structure is v1 rows, never v1 schema: each platoon is a `subunit`
// row and each section a `camp` row, always on shift. A section's camp is
// named "<platoon> <section>" ("PLATOON 1 SECTION 1") because v1 camp names
// are unique in a coy; everything that prints it shows "SECTION 1".

import type { CoySnapshot, SnapshotCamp, SnapshotPerson } from "@/lib/parade/types";
import { roleOf } from "./roles";

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

/** Service troopers leave at the changeover (phases-plan §1): ROT is combat troopers only. */
export const isSvc = (role: string) => roleOf(role) === "ST SVC";

/** A section's roles on the roster in ROT (mockup 10): its SC and its combat troopers. */
export const ROLES_SECTION = ["SC", "CBT"] as const;

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

// ------------------------------------------------------------------ the ROT parade state's snapshot

/**
 * The parade state's snapshot in ROT: the Vigilance camps the switch hid are
 * left out (they're empty now, and would fail v1's empty-camp check), and so
 * is a platoon left with no camps; each section prints as "SECTION 1"; and
 * Extra/RF/SOL are dropped, since they're served in Clementi and don't change
 * the ROT parade state (phases-plan §2). COY HQ is as it is.
 */
export function rotSnapshot(s: CoySnapshot, hiddenCampIds: readonly string[]): CoySnapshot {
  const hidden = new Set(hiddenCampIds);
  return {
    coy: s.coy,
    subunits: s.subunits
      .map((sub) =>
        sub.isHq ? sub : { ...sub, camps: sub.camps.filter((c) => !hidden.has(c.id)).map((c) => ({ ...c, name: sectionLabel(c.name, sub.name) })) },
      )
      .filter((sub) => sub.isHq || sub.camps.length > 0),
    duties: [],
  };
}

/** A drafted platoon, its sections, and who is placed in each (any order). */
export interface DraftPlatoon {
  id: string;
  name: string;
  sections: { id: string; name: string; personIds: readonly string[]; scIds: readonly string[] }[];
}

/**
 * The order men stand in a section: its SCs first, then everyone in the
 * order they stand on the roster today. Switch moves them in this order, so
 * the preview prints what the switch will.
 */
export function sectionOrder(personIds: readonly string[], scIds: readonly string[], rosterOrder: ReadonlyMap<string, number>): string[] {
  const rank = (id: string) => [scIds.includes(id) ? 0 : 1, rosterOrder.get(id) ?? Number.MAX_SAFE_INTEGER] as const;
  return [...personIds].sort((a, b) => {
    const [x1, x2] = rank(a);
    const [y1, y2] = rank(b);
    return x1 - y1 || x2 - y2;
  });
}

/** Everyone in a snapshot by roster order (platoon, camp, then within the camp). */
export function rosterOrder(s: CoySnapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const sub of s.subunits) for (const c of sub.camps) for (const p of c.people) out.set(p.id, out.size);
  return out;
}

/**
 * The ROT parade state as it would print from the draft, from today's
 * (Vigilance) snapshot: COY HQ as it is, then each drafted platoon and
 * section with the men placed there and their absences today. Men not
 * placed aren't counted (`unplaced`, COY HQ aside).
 */
export function draftSnapshot(s: CoySnapshot, platoons: readonly DraftPlatoon[]): { snapshot: CoySnapshot; unplaced: number } {
  const people = new Map<string, SnapshotPerson>();
  for (const sub of s.subunits) if (!sub.isHq) for (const c of sub.camps) for (const p of c.people) people.set(p.id, p);
  const order = rosterOrder(s);
  const placed = new Set<string>();
  const subunits = platoons.map((pl) => ({
    id: `draft:${pl.id}`,
    name: pl.name,
    isHq: false,
    camps: pl.sections.map(
      (sec): SnapshotCamp => ({
        id: `draft:${sec.id}`,
        name: sec.name,
        post: sec.name,
        onShift: true,
        people: sectionOrder(
          sec.personIds.filter((id) => people.has(id)),
          sec.scIds,
          order,
        ).map((id) => (placed.add(id), people.get(id)!)),
      }),
    ),
  }));
  return {
    snapshot: { coy: s.coy, subunits: [...s.subunits.filter((sub) => sub.isHq), ...subunits], duties: [] },
    unplaced: [...people.keys()].filter((id) => !placed.has(id)).length,
  };
}
