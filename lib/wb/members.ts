import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import type { Member } from "@/lib/wb/auth";

export interface Profile {
  rank: string;
  name: string;
  campName: string | null;
  subunitId: string | null;
  subunitName: string | null;
  onRoster: boolean;
}

/** Who a member is, from the roster if linked, else from what they told us. */
export async function profileOf(m: Member): Promise<Profile> {
  if (m.personId) {
    const [r] = await db
      .select({ rank: person.rank, name: person.name, campName: camp.name, subunitId: subunit.id, subunitName: subunit.name })
      .from(person)
      .innerJoin(camp, eq(camp.id, person.campId))
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .where(eq(person.id, m.personId));
    if (r) return { ...r, onRoster: true };
  }
  const [c] = m.selfCampId
    ? await db
        .select({ campName: camp.name, subunitId: subunit.id, subunitName: subunit.name })
        .from(camp)
        .innerJoin(subunit, eq(subunit.id, camp.subunitId))
        .where(eq(camp.id, m.selfCampId))
    : [];
  return {
    rank: m.selfRank ?? "",
    name: m.selfName ?? m.fullName ?? m.tgName,
    campName: c?.campName ?? null,
    subunitId: c?.subunitId ?? null,
    subunitName: c?.subunitName ?? null,
    onRoster: false,
  };
}
