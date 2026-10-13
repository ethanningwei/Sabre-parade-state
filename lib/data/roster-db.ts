// Reads the roster as it is in the DB, for the import's dry run (and the
// in-place import after it): the coy's active people with their camp names,
// and what hangs off each person, so a removal can be weighed before it runs.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { wbAssignment, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { absence, camp, coy, person, subunit } from "@/lib/db/schema";
import type { RosterRow, StakeCounts, Structure } from "@/lib/data/roster-plan";

type Reader = Pick<Db, "select">;

/** The coy's people (active, and inactive newest first) and its structure; all empty when the coy isn't in the DB yet. */
export async function loadRoster(
  db: Reader,
  coyKey: string,
): Promise<{ people: RosterRow[]; inactive: RosterRow[]; structure: Structure }> {
  const [c] = await db.select({ id: coy.id }).from(coy).where(eq(coy.key, coyKey));
  if (!c) return { people: [], inactive: [], structure: { camps: [], subunits: [] } };
  const camps = await db.select({ name: camp.name }).from(camp).where(eq(camp.coyId, c.id)).orderBy(camp.sortOrder);
  const subunits = await db.select({ name: subunit.name }).from(subunit).where(eq(subunit.coyId, c.id)).orderBy(subunit.sortOrder);
  const cols = { id: person.id, campName: camp.name, name: person.name, rank: person.rank, role: person.role };
  const people = await db
    .select(cols)
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(eq(camp.coyId, c.id), eq(person.active, true)))
    .orderBy(camp.sortOrder, person.sortOrder);
  const inactive = await db
    .select(cols)
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(eq(camp.coyId, c.id), eq(person.active, false)))
    .orderBy(desc(person.createdAt));
  return { people, inactive, structure: { camps: camps.map((r) => r.name), subunits: subunits.map((r) => r.name) } };
}

/** What each person has attached to them, keyed by person id. Only non-zero entries are returned. */
export async function rosterStakes(db: Db, personIds: string[]): Promise<Map<string, StakeCounts>> {
  const out = new Map<string, StakeCounts>();
  if (!personIds.length) return out;
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { members: 0, records: 0, assignments: 0, absences: 0 }));
    return s;
  };
  const n = sql<number>`count(*)::int`;
  const [members, records, assignments, absences] = await Promise.all([
    db.select({ id: wbMember.personId, n }).from(wbMember).where(inArray(wbMember.personId, personIds)).groupBy(wbMember.personId),
    db.select({ id: wbRecord.personId, n }).from(wbRecord).where(inArray(wbRecord.personId, personIds)).groupBy(wbRecord.personId),
    db
      .select({ id: wbAssignment.personId, n })
      .from(wbAssignment)
      .where(inArray(wbAssignment.personId, personIds))
      .groupBy(wbAssignment.personId),
    db.select({ id: absence.personId, n }).from(absence).where(inArray(absence.personId, personIds)).groupBy(absence.personId),
  ]);
  for (const r of members) if (r.id) get(r.id).members = r.n;
  for (const r of records) get(r.id).records = r.n;
  for (const r of assignments) get(r.id).assignments = r.n;
  for (const r of absences) get(r.id).absences = r.n;
  return out;
}
