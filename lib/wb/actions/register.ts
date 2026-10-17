"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { db } from "@/lib/db";
import { camp, subunit } from "@/lib/db/schema";
import { requireFeature } from "@/lib/flags";
import { wbAudit } from "@/lib/wb/audit";
import { actionMember } from "@/lib/wb/auth";
import { wbMember } from "@/lib/wb/db/schema";
import { ddmmyy, leaveDays, linkedToSomeoneElse, matchName, nric4, TAKEN_MESSAGE } from "@/lib/wb/domain/registration";
import { RANKS, rolesFor } from "@/lib/wb/domain/roles";
import { rosterContaining, rosterPerson } from "@/lib/wb/roster";
import { toSgt } from "@/lib/parade/time";

export interface FoundPerson {
  personId: string;
  rank: string;
  name: string;
  campName: string;
  subunitName: string;
  role: string;
  taken: boolean;
}

export type FindResult =
  | { kind: "none" }
  | { kind: "too-many"; count: number }
  | { kind: "one"; person: FoundPerson }
  | { kind: "pick"; people: FoundPerson[] };

/** Registration step 1: who is this? Matches against active roster names. */
export async function findMe(name: string) {
  requireFeature();
  return run(async (): Promise<FindResult> => {
    const me = await actionMember();
    const q = z.string().trim().min(2, "Type at least 2 letters of your name.").max(100).parse(name);
    const result = matchName(q, await rosterContaining(q));
    const show = (p: Awaited<ReturnType<typeof rosterContaining>>[number]): FoundPerson => ({
      personId: p.personId,
      rank: p.rank,
      name: p.name,
      campName: p.campName,
      subunitName: p.subunitName,
      role: p.role,
      taken: linkedToSomeoneElse(p, me.id),
    });
    switch (result.kind) {
      case "one":
        return { kind: "one", person: show(result.person) };
      case "pick":
        return { kind: "pick", people: result.people.map(show) };
      default:
        return result;
    }
  });
}

const details = z
  .object({
    fullName: z.string().trim().min(3, "Type your full name, as on your NRIC.").max(100),
    nric: z.string(),
    ord: z.string(),
    leaveLeft: z.string(),
    stayout: z.enum(["NONE", "PERM", "TEMP"]),
    stayoutUntil: z.string().optional().default(""),
  })
  .transform((d, ctx) => {
    const n = nric4(d.nric);
    if (!n) ctx.addIssue({ code: "custom", message: "NRIC: last 4 only, 3 digits and a letter, e.g. 567A." });
    const ord = ddmmyy(d.ord);
    if (!ord) ctx.addIssue({ code: "custom", message: "ORD: give the date as DDMMYY, e.g. 270828." });
    const leave = leaveDays(d.leaveLeft);
    if (leave === null) ctx.addIssue({ code: "custom", message: "Leave left: give a plain number, e.g. 14." });
    let until: string | null = null;
    if (d.stayout === "TEMP") {
      until = ddmmyy(d.stayoutUntil);
      if (!until) ctx.addIssue({ code: "custom", message: "Stay-out until: give the date as DDMMYY." });
      else if (until < toSgt(new Date()).date) ctx.addIssue({ code: "custom", message: "The last day of your stay-out can't be in the past." });
    }
    return {
      fullName: d.fullName.toUpperCase().split(/\s+/).join(" "),
      nric4: n ?? "",
      ordDate: ord ?? "",
      leaveLeft: leave ?? 0,
      stayout: d.stayout,
      stayoutUntil: until,
    };
  });

// Either a roster person, or what a trooper who isn't on the roster tells us.
// One object rather than a union, so detail errors reach the user as written.
const registerInput = z
  .object({
    personId: z.uuid().optional(),
    self: z
      .object({
        name: z.string().trim().min(2, "Type your name as on the parade state.").max(100),
        campId: z.uuid("Pick your camp."),
        role: z.string().min(1, "Pick your role."),
        rank: z.enum(RANKS, "Pick your rank."),
      })
      .optional(),
    details,
  })
  .refine((v) => !!v.personId !== !!v.self, "Try your name again.");

export type RegisterInput = z.input<typeof registerInput>;

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Registration's last step: link to the roster person (or record a SELF sign-up) and save the details. */
export async function register(raw: RegisterInput) {
  requireFeature();
  return run(async () => {
    const me = await actionMember();
    const input = registerInput.parse(raw);
    // the evening round takes him off the roster on this date; a date already stored is kept (a reopened account)
    if (input.details.ordDate < toSgt(new Date()).date && input.details.ordDate !== me.ordDate) throw new UserError("Your ORD date can't be in the past.");

    let link: Partial<typeof wbMember.$inferInsert>;
    if (input.personId) {
      const p = await rosterPerson(input.personId);
      if (!p || !p.active) throw new UserError("That person is no longer on the roster. Try your name again.");
      if (linkedToSomeoneElse(p, me.id)) throw new UserError(TAKEN_MESSAGE);
      link = { personId: p.personId, source: "ROSTER", selfName: null, selfRank: null, selfRole: null, selfCampId: null };
    } else {
      const self = input.self!;
      const [c] = await db
        .select({ id: camp.id, isHq: subunit.isHq })
        .from(camp)
        .innerJoin(subunit, eq(subunit.id, camp.subunitId))
        .where(eq(camp.id, self.campId));
      if (!c) throw new UserError("Pick your camp again.");
      if (!rolesFor(c.isHq).includes(self.role)) throw new UserError("Pick a role that fits that camp.");
      link = {
        personId: null,
        source: "SELF",
        selfName: self.name.toUpperCase().split(/\s+/).join(" "),
        selfRank: self.rank,
        selfRole: self.role,
        selfCampId: c.id,
      };
    }

    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(wbMember)
          .set({ ...link, ...input.details, registeredAt: me.registeredAt ?? now })
          .where(eq(wbMember.id, me.id));
        await wbAudit(tx, {
          memberId: me.id,
          via: "MINIAPP",
          action: me.registeredAt ? "re-register" : "register",
          entity: "wb_member",
          entityId: me.id,
          before: { personId: me.personId, source: me.source },
          // never the NRIC digits in the audit trail
          after: { personId: link.personId, source: link.source, selfCampId: link.selfCampId ?? null },
        });
      });
    } catch (e) {
      // someone else linked the same person between the check and the write
      if (uniqueViolation(e)) throw new UserError(TAKEN_MESSAGE);
      throw e;
    }
    return undefined;
  });
}
