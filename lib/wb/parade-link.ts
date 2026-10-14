import "server-only";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError } from "@/lib/authz";
import { db } from "@/lib/db";
import { person, user } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { startSession } from "@/lib/session";
import { hasGrant, type Member } from "@/lib/wb/auth";
import { wbAudit } from "@/lib/wb/audit";
import { markFromTelegram } from "@/lib/wb/from-telegram";
import { PARADE_STATE_ROLES } from "@/lib/wb/permissions";
import { PROJECTOR_USER } from "@/lib/wb/projection";

// "Parade state" in the Mini App: signs a commander in to the v1 web app by
// name, in the same Telegram window, without the shared password. v1's own
// sign-in (startSession) does the work; this only picks the name and says who.

/** v1's login form normalises a typed name the same way (lib/actions/auth.ts). */
const v1Name = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 60);

/** "RANK NAME" from the roster, else the Telegram name. */
async function nameFor(m: Member): Promise<string> {
  if (m.personId) {
    const [p] = await db.select({ rank: person.rank, name: person.name }).from(person).where(eq(person.id, m.personId));
    if (p) return v1Name(`${p.rank} ${p.name}`);
  }
  return v1Name(m.tgName);
}

/** Starts a v1 session for the member and marks it as from Telegram. Returns the v1 name. */
export async function signInToParadeState(m: Member): Promise<{ name: string }> {
  if (!hasGrant(m.grants, PARADE_STATE_ROLES, "any")) {
    throw new ForbiddenError("Only GCs, PSs, PCs, the OC, 2IC, CSM and admins can open the parade state from here.");
  }
  const name = await nameFor(m);
  if (name.length < 2) throw new UserError("Your name is missing. Redo My details, then try again.");
  // the projector's v1 user is inactive on purpose: startSession would make it an admin
  if (name.toLowerCase() === PROJECTOR_USER.name.toLowerCase()) throw new UserError("That name is reserved. Ask an admin.");

  const [existing] = await db.select({ active: user.active }).from(user).where(sql`lower(${user.name}) = lower(${name})`);
  if (existing && !existing.active) {
    throw new UserError(`${name} has been switched off in the parade state. Ask a parade-state admin to switch it back on.`);
  }

  await startSession(name);
  await markFromTelegram();
  const [u] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.name}) = lower(${name})`);
  await wbAudit(db, { memberId: m.id, via: "MINIAPP", action: "open-parade-state", entity: "user", entityId: u.id, after: { name } });
  return { name };
}
