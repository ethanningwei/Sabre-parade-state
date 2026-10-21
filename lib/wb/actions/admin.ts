"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import * as writes from "@/lib/wb/admin";
import { actionMember, requireScreen } from "@/lib/wb/auth";
import { miniApp } from "@/lib/wb/input";
import { place } from "@/lib/wb/format";
import { WB_ROLES } from "@/lib/wb/db/schema";
import { rosterContaining } from "@/lib/wb/roster";
import type { Outcome } from "@/lib/wb/write";

// Mini App admin (ADMIN grant only): members, grants, commanders' chats. The
// writes, and who may make them, are in lib/wb/admin.ts; this checks input.

const id = z.uuid();

// requireFeature() runs outside run(), so a disabled feature is a real 404 rather than an error message
const admin = () => requireScreen("admin");
const asAdmin = async () => miniApp(await actionMember());

function done(res: Outcome<unknown>) {
  if (!res.ok) throw new UserError(res.error);
  return undefined;
}

// ---------------------------------------------------------------- members

/** Roster search for linking a member. */
export async function searchRoster(query: string) {
  requireFeature();
  return run(async () => {
    await admin();
    const q = z.string().trim().min(2, "Type at least 2 letters.").max(100).parse(query);
    const rows = await rosterContaining(q);
    return rows.slice(0, 20).map((p) => ({
      personId: p.personId,
      label: `${p.rank} ${p.name}`,
      where: place(p.campName, p.subunitName),
      linked: p.linkedMemberId !== null,
    }));
  });
}

export async function linkMember(memberId: string, personId: string) {
  requireFeature();
  return run(async () => done(await writes.linkMember(await asAdmin(), id.parse(memberId), id.parse(personId))));
}

export async function unlinkMember(memberId: string) {
  requireFeature();
  return run(async () => done(await writes.unlinkMember(await asAdmin(), id.parse(memberId))));
}

export async function setMemberActive(memberId: string, active: boolean) {
  requireFeature();
  return run(async () => done(await writes.setMemberActive(await asAdmin(), id.parse(memberId), z.boolean().parse(active))));
}

// ---------------------------------------------------------------- grants

const grantInput = z.object({
  memberId: id,
  role: z.enum(WB_ROLES, "Pick a role."),
  /** "company", "subunit:<uuid>" or "camp:<uuid>" */
  scope: z.string().regex(/^(company|subunit:[0-9a-f-]{36}|camp:[0-9a-f-]{36})$/, "Pick a scope."),
});

export async function addGrant(raw: z.input<typeof grantInput>) {
  requireFeature();
  return run(async () => done(await writes.addGrant(await asAdmin(), grantInput.parse(raw))));
}

export async function removeGrant(grantId: string) {
  requireFeature();
  return run(async () => done(await writes.removeGrant(await asAdmin(), id.parse(grantId))));
}

// ---------------------------------------------------------------- commanders' chats

export async function removeCommanderChat(chatRowId: string) {
  requireFeature();
  return run(async () => done(await writes.removeCommanderChat(await asAdmin(), id.parse(chatRowId))));
}
