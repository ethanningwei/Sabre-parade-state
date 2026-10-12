import "server-only";
import type { Member } from "@/lib/wb/auth";
import { personWhere, type ScopedPerson } from "@/lib/wb/records";

/** The member's roster person, if they're linked to an active one. Only they can put things on their own timeline. */
export async function rosterSelf(m: Member): Promise<ScopedPerson | null> {
  return m.personId ? personWhere(m.personId) : null;
}
