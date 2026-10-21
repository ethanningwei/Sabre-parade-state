import "server-only";
import { eq } from "drizzle-orm";
import { toSgt } from "@/lib/parade/time";
import { camp, subunit } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import { wbMember } from "@/lib/wb/db/schema";
import { linkedToSomeoneElse, TAKEN_MESSAGE } from "@/lib/wb/domain/registration";
import { rolesFor } from "@/lib/wb/domain/roles";
import { rosterPerson } from "@/lib/wb/roster";
import { write, type Acting } from "@/lib/wb/write";

// Registration's write: the one a member makes before he's registered. Links
// him to his roster person (or records a SELF sign-up) and saves his details.
// Nothing reaches the parade state until he has records.

export interface Registration {
  /** the roster person he picked; or `self`, what a trooper who isn't on the roster tells us */
  personId?: string;
  self?: { name: string; campId: string; role: string; rank: string };
  details: { fullName: string; nric4: string; ordDate: string; leaveLeft: number; stayout: "NONE" | "PERM" | "TEMP"; stayoutUntil: string | null };
}

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function registerMember(by: Acting, input: Registration) {
  return write(null, by, {
    parade: false,
    unregistered: true,
    async change({ tx, audit }) {
      const [me] = await tx.select().from(wbMember).where(eq(wbMember.id, by.actor.id)).for("update");
      if (!me) throw new Refusal("Please reopen Sabre from Telegram.");
      // the evening round takes him off the roster on this date; a date already stored is kept (a reopened account)
      if (input.details.ordDate < toSgt(new Date()).date && input.details.ordDate !== me.ordDate) throw new Refusal("Your ORD date can't be in the past.");

      let link: Partial<typeof wbMember.$inferInsert>;
      if (input.personId) {
        const p = await rosterPerson(input.personId);
        if (!p || !p.active) throw new Refusal("That person is no longer on the roster. Try your name again.");
        if (linkedToSomeoneElse(p, me.id)) throw new Refusal(TAKEN_MESSAGE);
        link = { personId: p.personId, source: "ROSTER", selfName: null, selfRank: null, selfRole: null, selfCampId: null };
      } else {
        const self = input.self!;
        const [c] = await tx
          .select({ id: camp.id, isHq: subunit.isHq })
          .from(camp)
          .innerJoin(subunit, eq(subunit.id, camp.subunitId))
          .where(eq(camp.id, self.campId));
        if (!c) throw new Refusal("Pick your camp again.");
        if (!rolesFor(c.isHq).includes(self.role)) throw new Refusal("Pick a role that fits that camp.");
        link = {
          personId: null,
          source: "SELF",
          selfName: self.name.toUpperCase().split(/\s+/).join(" "),
          selfRank: self.rank,
          selfRole: self.role,
          selfCampId: c.id,
        };
      }

      try {
        await tx
          .update(wbMember)
          .set({ ...link, ...input.details, registeredAt: me.registeredAt ?? new Date() })
          .where(eq(wbMember.id, me.id));
      } catch (e) {
        // someone else linked the same person between the check and the write
        if (uniqueViolation(e)) throw new Refusal(TAKEN_MESSAGE);
        throw e;
      }
      await audit({
        action: me.registeredAt ? "re-register" : "register",
        entity: "wb_member",
        entityId: me.id,
        before: { personId: me.personId, source: me.source },
        // never the NRIC digits in the audit trail
        after: { personId: link.personId, source: link.source, selfCampId: link.selfCampId ?? null },
      });
    },
  });
}
