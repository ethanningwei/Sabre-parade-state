"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember, type Member } from "@/lib/wb/auth";
import type { Actor } from "@/lib/wb/core";
import { addPersonToRoster, addToRoster, editRosterPerson, linkToRoster, removeFromRoster } from "@/lib/wb/roster-flow";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's roster flow: Remove from roster (Person history); Add to
// roster / Link to existing for a waiting account, and + Add person and Edit
// (Roster). Rules and scope are in lib/wb/roster-flow.ts.

const zId = z.uuid();
const actorOf = (m: Member): Actor => ({ id: m.id, personId: m.personId, grants: m.grants });

async function commander(): Promise<Member> {
  const member = await actionMember();
  if (!member.registeredAt) throw new UserError("Register first.");
  return member;
}

export async function removeFromRosterAction(personId: string) {
  requireFeature();
  return run(async () => {
    const res = await removeFromRoster(await courier(), actorOf(await commander()), zId.parse(personId));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

const personInput = z.object({
  campId: z.uuid("Pick his camp."),
  rank: z.string().min(1, "Pick his rank."),
  name: z.string().trim().min(2, "Type his name as it should be on the parade state.").max(100),
  role: z.string().min(1, "Pick his role."),
});
const addInput = personInput.extend({ memberId: zId });
/** An edit may send back a role v1 has as blank: it's kept as it is. */
const editInput = personInput.extend({ role: z.string().max(100) });

export async function addToRosterAction(raw: z.input<typeof addInput>) {
  requireFeature();
  return run(async () => {
    const res = await addToRoster(await courier(), actorOf(await commander()), addInput.parse(raw));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

export async function linkToRosterAction(memberId: string, personId: string) {
  requireFeature();
  return run(async () => {
    const res = await linkToRoster(await courier(), actorOf(await commander()), zId.parse(memberId), zId.parse(personId));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

export async function addPersonAction(raw: z.input<typeof personInput>) {
  requireFeature();
  return run(async () => {
    const res = await addPersonToRoster(actorOf(await commander()), personInput.parse(raw));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

export async function editPersonAction(personId: string, raw: z.input<typeof editInput>) {
  requireFeature();
  return run(async () => {
    const res = await editRosterPerson(actorOf(await commander()), zId.parse(personId), editInput.parse(raw));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}
