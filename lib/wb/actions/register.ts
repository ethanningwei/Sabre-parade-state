"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { miniApp } from "@/lib/wb/input";
import { ddmmyy, leaveDays, linkedToSomeoneElse, matchName, nric4 } from "@/lib/wb/domain/registration";
import { RANKS } from "@/lib/wb/domain/roles";
import { registerMember } from "@/lib/wb/register";
import { rosterContaining } from "@/lib/wb/roster";
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

/** Registration's last step: link to the roster person (or record a SELF sign-up) and save the details. */
export async function register(raw: RegisterInput) {
  requireFeature();
  return run(async () => {
    const me = await actionMember();
    const res = await registerMember(miniApp(me), registerInput.parse(raw));
    if (!res.ok) throw new UserError(res.error);
    return undefined;
  });
}
