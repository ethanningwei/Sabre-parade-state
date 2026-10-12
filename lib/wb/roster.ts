import "server-only";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbMember } from "@/lib/wb/db/schema";

// Read-only views of the v1 roster for the Mini App.

export interface RosterPerson {
  personId: string;
  name: string;
  rank: string;
  role: string;
  campId: string;
  campName: string;
  subunitId: string;
  subunitName: string;
  linkedMemberId: string | null;
}

const rosterColumns = {
  personId: person.id,
  name: person.name,
  rank: person.rank,
  role: person.role,
  campId: camp.id,
  campName: camp.name,
  subunitId: subunit.id,
  subunitName: subunit.name,
  linkedMemberId: wbMember.id,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Active roster people whose name contains `query` (case-insensitive). */
export async function rosterContaining(query: string): Promise<RosterPerson[]> {
  const q = query.trim().split(/\s+/).filter(Boolean).join(" ");
  if (!q) return [];
  return db
    .select(rosterColumns)
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(wbMember, eq(wbMember.personId, person.id))
    .where(and(eq(person.active, true), ilike(person.name, `%${escapeLike(q)}%`)))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
}

export async function rosterPerson(personId: string): Promise<(RosterPerson & { active: boolean }) | null> {
  const [row] = await db
    .select({ ...rosterColumns, active: person.active })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(wbMember, eq(wbMember.personId, person.id))
    .where(eq(person.id, personId));
  return row ?? null;
}

export interface SubunitWithCamps {
  id: string;
  name: string;
  isHq: boolean;
  camps: { id: string; name: string }[];
}

/** Platoons and their camps, in parade-state order. */
export async function structure(): Promise<SubunitWithCamps[]> {
  const rows = await db
    .select({ sId: subunit.id, sName: subunit.name, isHq: subunit.isHq, cId: camp.id, cName: camp.name })
    .from(subunit)
    .leftJoin(camp, eq(camp.subunitId, subunit.id))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder));
  const out = new Map<string, SubunitWithCamps>();
  for (const r of rows) {
    const s = out.get(r.sId) ?? { id: r.sId, name: r.sName, isHq: r.isHq, camps: [] };
    if (r.cId && r.cName) s.camps.push({ id: r.cId, name: r.cName });
    out.set(r.sId, s);
  }
  return [...out.values()];
}
