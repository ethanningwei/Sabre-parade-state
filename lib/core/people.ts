// The bodies of v1's savePerson and removePerson, as plain functions. The
// server actions (lib/actions/admin.ts) do the sign-in and input parsing and
// call these; the whereabouts roster flow (lib/wb/roster-flow.ts) calls them
// as the projector's v1 user. The rules live here only.

import { and, eq, isNull, max } from "drizzle-orm";
import type { db } from "@/lib/db";
import { absence, person } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { writeAudit, type Tx } from "./audit";

/** savePerson's input once parsed: rank and name trimmed and upper-cased. */
export interface PersonValues {
  personId?: string;
  campId: string;
  rank: string;
  name: string;
  role: string;
}

type Person = typeof person.$inferSelect;

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Add someone to a camp (at the end), or edit them; a move to another camp puts them at its end. */
export async function savePersonCore(tx: Tx | typeof db, actorId: string | null, input: PersonValues): Promise<Person> {
  try {
    if (input.personId) {
      const [before] = await tx.select().from(person).where(eq(person.id, input.personId));
      if (!before) throw new UserError("Person not found.");
      const values = { campId: input.campId, rank: input.rank, name: input.name, role: input.role };
      if (before.campId !== input.campId) {
        const [{ last }] = await tx.select({ last: max(person.sortOrder) }).from(person).where(eq(person.campId, input.campId));
        Object.assign(values, { sortOrder: (last ?? -1) + 1 });
      }
      const [row] = await tx.update(person).set(values).where(eq(person.id, input.personId)).returning();
      await writeAudit(tx, actorId, "update-person", "person", input.personId, before, values);
      return row;
    }
    const [{ last }] = await tx.select({ last: max(person.sortOrder) }).from(person).where(eq(person.campId, input.campId));
    const [row] = await tx
      .insert(person)
      .values({ campId: input.campId, rank: input.rank, name: input.name, role: input.role, sortOrder: (last ?? -1) + 1 })
      .returning();
    await writeAudit(tx, actorId, "create-person", "person", row.id, null, row);
    return row;
  } catch (e) {
    if (uniqueViolation(e)) throw new UserError(`'${input.name}' is already in that camp. Add a surname to tell them apart.`);
    throw e;
  }
}

/** Off the roster (ORD, posted out). Kept for history, never counted again. */
export async function removePersonCore(tx: Tx, actorId: string | null, personId: string) {
  await tx.update(person).set({ active: false }).where(eq(person.id, personId));
  await tx
    .update(absence)
    .set({ closedAt: new Date(), closedBy: actorId })
    .where(and(eq(absence.personId, personId), isNull(absence.closedAt)));
  await writeAudit(tx, actorId, "remove-person", "person", personId, null, { active: false });
}
