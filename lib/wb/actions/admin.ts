"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { db } from "@/lib/db";
import { camp, subunit } from "@/lib/db/schema";
import { requireFeature } from "@/lib/flags";
import { wbAudit } from "@/lib/wb/audit";
import { requireScreen } from "@/lib/wb/auth";
import { onlyCampScope } from "@/lib/wb/domain/access";
import { place } from "@/lib/wb/format";
import { WB_ROLES, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { linkedToSomeoneElse, TAKEN_MESSAGE } from "@/lib/wb/domain/registration";
import { rosterContaining, rosterPerson } from "@/lib/wb/roster";

// Mini App admin (ADMIN grant only): members, grants, commanders' chats.

const id = z.uuid();

// requireFeature() runs outside run(), so a disabled feature is a real 404 rather than an error message
const admin = () => requireScreen("admin");

async function memberRow(memberId: string) {
  const [m] = await db.select().from(wbMember).where(eq(wbMember.id, memberId));
  if (!m) throw new UserError("That member no longer exists.");
  return m;
}

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
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
  return run(async () => {
    const me = await admin();
    const m = await memberRow(id.parse(memberId));
    const p = await rosterPerson(id.parse(personId));
    if (!p || !p.active) throw new UserError("That person is no longer on the roster.");
    if (linkedToSomeoneElse(p, m.id)) throw new UserError(TAKEN_MESSAGE.replace("Ask your PS to sort it out.", "Unlink them first."));
    try {
      await db.transaction(async (tx) => {
        await tx.update(wbMember).set({ personId: p.personId, source: "ROSTER" }).where(eq(wbMember.id, m.id));
        await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: "link", entity: "wb_member", entityId: m.id, before: { personId: m.personId }, after: { personId: p.personId } });
      });
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError("Someone else was just linked to that person.");
      throw e;
    }
    return undefined;
  });
}

export async function unlinkMember(memberId: string) {
  requireFeature();
  return run(async () => {
    const me = await admin();
    const m = await memberRow(id.parse(memberId));
    await db.transaction(async (tx) => {
      await tx.update(wbMember).set({ personId: null }).where(eq(wbMember.id, m.id));
      await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: "unlink", entity: "wb_member", entityId: m.id, before: { personId: m.personId }, after: { personId: null } });
    });
    return undefined;
  });
}

export async function setMemberActive(memberId: string, active: boolean) {
  requireFeature();
  return run(async () => {
    const me = await admin();
    const m = await memberRow(id.parse(memberId));
    if (m.id === me.id && !active) throw new UserError("You can't deactivate yourself.");
    await db.transaction(async (tx) => {
      await tx.update(wbMember).set({ active: z.boolean().parse(active) }).where(eq(wbMember.id, m.id));
      await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: active ? "reactivate" : "deactivate", entity: "wb_member", entityId: m.id, before: { active: m.active }, after: { active } });
    });
    return undefined;
  });
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
  return run(async () => {
    const me = await admin();
    const input = grantInput.parse(raw);
    const m = await memberRow(input.memberId);
    if (!m.active || !m.registeredAt) throw new UserError("Only active, registered members can be given a role.");

    const [kind, scopeId] = input.scope.split(":") as ["company" | "subunit" | "camp", string | undefined];
    if (onlyCampScope(input.role) && kind !== "camp") throw new UserError(`A ${input.role} grant is for one camp. Pick his camp.`);
    if (kind === "subunit") {
      const [s] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.id, scopeId!));
      if (!s) throw new UserError("That platoon no longer exists.");
    }
    if (kind === "camp") {
      const [c] = await db.select({ id: camp.id }).from(camp).where(eq(camp.id, scopeId!));
      if (!c) throw new UserError("That camp no longer exists.");
    }
    const values = {
      memberId: m.id,
      role: input.role,
      subunitId: kind === "subunit" ? scopeId! : null,
      campId: kind === "camp" ? scopeId! : null,
      grantedBy: me.id,
    };
    try {
      await db.transaction(async (tx) => {
        const [g] = await tx.insert(wbGrant).values(values).returning({ id: wbGrant.id });
        await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: "grant", entity: "wb_grant", entityId: g.id, after: values });
      });
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError("They already have that role there.");
      throw e;
    }
    return undefined;
  });
}

export async function removeGrant(grantId: string) {
  requireFeature();
  return run(async () => {
    const me = await admin();
    const [g] = await db.select().from(wbGrant).where(eq(wbGrant.id, id.parse(grantId)));
    if (!g) return undefined;
    if (g.role === "ADMIN") {
      const [{ n }] = await db
        .select({ n: count() })
        .from(wbGrant)
        .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
        .where(and(eq(wbGrant.role, "ADMIN"), ne(wbGrant.id, g.id), eq(wbMember.active, true)));
      if (n === 0) throw new UserError("That's the last admin. Make someone else an admin first.");
    }
    await db.transaction(async (tx) => {
      await tx.delete(wbGrant).where(eq(wbGrant.id, g.id));
      await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: "revoke", entity: "wb_grant", entityId: g.id, before: g });
    });
    return undefined;
  });
}

// ---------------------------------------------------------------- commanders' chats

export async function removeCommanderChat(chatRowId: string) {
  requireFeature();
  return run(async () => {
    const me = await admin();
    const [c] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.id, id.parse(chatRowId)));
    if (!c) return undefined;
    await db.transaction(async (tx) => {
      await tx.delete(wbCommanderChat).where(eq(wbCommanderChat.id, c.id));
      await wbAudit(tx, { memberId: me.id, via: "MINIAPP", action: "unlink-chat", entity: "wb_commander_chat", entityId: c.id, before: c });
    });
    return undefined;
  });
}
