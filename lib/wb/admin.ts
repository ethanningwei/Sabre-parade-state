import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { camp, subunit } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import { wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { onlyCampScope, platoonAccess, screens } from "@/lib/wb/domain/access";
import { linkedToSomeoneElse, TAKEN_MESSAGE } from "@/lib/wb/domain/registration";
import type { WbRole } from "@/lib/wb/domain/roles";
import type { Db } from "@/lib/wb/records";
import { rosterPerson } from "@/lib/wb/roster";
import { write, type Acting } from "@/lib/wb/write";

// Members, grants and commanders' chats: the admin's writes (Mini App ›
// Admin) and /here. None of them is on the parade state.

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function mustBeAdmin(by: Acting) {
  if (!screens(by.actor).admin) throw new Refusal("You don't have permission to do that.");
}

async function memberRow(tx: Db, memberId: string) {
  const [m] = await tx.select().from(wbMember).where(eq(wbMember.id, memberId)).for("update");
  if (!m) throw new Refusal("That member no longer exists.");
  return m;
}

// ---------------------------------------------------------------- members

export async function linkMember(by: Acting, memberId: string, personId: string) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const m = await memberRow(tx, memberId);
      const p = await rosterPerson(personId);
      if (!p || !p.active) throw new Refusal("That person is no longer on the roster.");
      if (linkedToSomeoneElse(p, m.id)) throw new Refusal(TAKEN_MESSAGE.replace("Ask your PS to sort it out.", "Unlink them first."));
      try {
        await tx.update(wbMember).set({ personId: p.personId, source: "ROSTER" }).where(eq(wbMember.id, m.id));
      } catch (e) {
        if (uniqueViolation(e)) throw new Refusal("Someone else was just linked to that person.");
        throw e;
      }
      await audit({ action: "link", entity: "wb_member", entityId: m.id, before: { personId: m.personId }, after: { personId: p.personId } });
    },
  });
}

export async function unlinkMember(by: Acting, memberId: string) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const m = await memberRow(tx, memberId);
      await tx.update(wbMember).set({ personId: null }).where(eq(wbMember.id, m.id));
      await audit({ action: "unlink", entity: "wb_member", entityId: m.id, before: { personId: m.personId }, after: { personId: null } });
    },
  });
}

export async function setMemberActive(by: Acting, memberId: string, active: boolean) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const m = await memberRow(tx, memberId);
      if (m.id === by.actor.id && !active) throw new Refusal("You can't deactivate yourself.");
      await tx.update(wbMember).set({ active }).where(eq(wbMember.id, m.id));
      await audit({ action: active ? "reactivate" : "deactivate", entity: "wb_member", entityId: m.id, before: { active: m.active }, after: { active } });
    },
  });
}

// ---------------------------------------------------------------- grants

export interface NewGrant {
  memberId: string;
  role: WbRole;
  /** "company", "subunit:<uuid>" or "camp:<uuid>" */
  scope: string;
}

export async function addGrant(by: Acting, input: NewGrant) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const m = await memberRow(tx, input.memberId);
      if (!m.active || !m.registeredAt) throw new Refusal("Only active, registered members can be given a role.");
      const [kind, scopeId] = input.scope.split(":") as ["company" | "subunit" | "camp", string | undefined];
      if (onlyCampScope(input.role) && kind !== "camp") throw new Refusal(`A ${input.role} grant is for one camp. Pick his camp.`);
      if (kind === "subunit") {
        const [s] = await tx.select({ id: subunit.id }).from(subunit).where(eq(subunit.id, scopeId!));
        if (!s) throw new Refusal("That platoon no longer exists.");
      }
      if (kind === "camp") {
        const [c] = await tx.select({ id: camp.id }).from(camp).where(eq(camp.id, scopeId!));
        if (!c) throw new Refusal("That camp no longer exists.");
      }
      const values = {
        memberId: m.id,
        role: input.role,
        subunitId: kind === "subunit" ? scopeId! : null,
        campId: kind === "camp" ? scopeId! : null,
        grantedBy: by.actor.id,
      };
      let g: { id: string };
      try {
        [g] = await tx.insert(wbGrant).values(values).returning({ id: wbGrant.id });
      } catch (e) {
        if (uniqueViolation(e)) throw new Refusal("They already have that role there.");
        throw e;
      }
      await audit({ action: "grant", entity: "wb_grant", entityId: g.id, after: values });
    },
  });
}

export async function removeGrant(by: Acting, grantId: string) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const [g] = await tx.select().from(wbGrant).where(eq(wbGrant.id, grantId));
      if (!g) return;
      if (g.role === "ADMIN") {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(wbGrant)
          .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
          .where(and(eq(wbGrant.role, "ADMIN"), ne(wbGrant.id, g.id), eq(wbMember.active, true)));
        if (n === 0) throw new Refusal("That's the last admin. Make someone else an admin first.");
      }
      await tx.delete(wbGrant).where(eq(wbGrant.id, g.id));
      await audit({ action: "revoke", entity: "wb_grant", entityId: g.id, before: g });
    },
  });
}

// ---------------------------------------------------------------- commanders' chats

export async function removeCommanderChat(by: Acting, chatRowId: string) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      mustBeAdmin(by);
      const [c] = await tx.select().from(wbCommanderChat).where(eq(wbCommanderChat.id, chatRowId));
      if (!c) return;
      await tx.delete(wbCommanderChat).where(eq(wbCommanderChat.id, c.id));
      await audit({ action: "unlink-chat", entity: "wb_commander_chat", entityId: c.id, before: c });
    },
  });
}

export interface ChatLink {
  subunit: { id: string; name: string };
  chatId: number;
  threadId: number | null;
  chatTitle: string;
}

/**
 * /here: this chat (or topic) becomes the platoon's commanders chat, for its
 * PC or PS or a Sabre admin. Returns the chat it replaced, or "same" when it
 * already was.
 */
export async function linkCommanderChat(by: Acting, link: ChatLink) {
  return write(null, by, {
    parade: false,
    async change({ tx, audit }) {
      const { subunit: target, chatId, threadId, chatTitle } = link;
      if (!platoonAccess(by.actor, target.id).linkChat) throw new Refusal(`Only ${target.name}'s PC or PS (or a Sabre admin) can link this chat.`);
      const [before] = await tx.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, target.id)).for("update");
      if (before && before.chatId === chatId && before.threadId === threadId) return "same" as const;
      const values = { subunitId: target.id, chatId, threadId, chatTitle, linkedBy: by.actor.id, linkedAt: new Date() };
      const [row] = await tx
        .insert(wbCommanderChat)
        .values(values)
        .onConflictDoUpdate({ target: wbCommanderChat.subunitId, set: values })
        .returning({ id: wbCommanderChat.id });
      await audit({ action: "link-chat", entity: "wb_commander_chat", entityId: row.id, before: before ?? null, after: values });
      return { replaced: before ?? null };
    },
  });
}
