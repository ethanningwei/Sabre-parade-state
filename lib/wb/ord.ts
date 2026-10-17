import "server-only";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/core/audit";
import { removePersonCore } from "@/lib/core/people";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { bootstrapAdminIds } from "@/lib/wb/auth";
import { wbAudit as wbAuditTable, wbMember } from "@/lib/wb/db/schema";
import { ORD_ACTION, ordText, type OrdMan } from "@/lib/wb/domain/ord";
import { ensureProjectorUser, PROJECTOR_USER, syncQuietly } from "@/lib/wb/projection";
import { cleanupWhereabouts, lastAdmin, redrawAfter, type Cleanup } from "@/lib/wb/roster-flow";
import type { Courier } from "@/lib/wb/telegram/courier";

// ORD (status §5, 2026-10-17): at the evening round, everyone whose ORD date
// has come is sent off with a DM and taken off the roster exactly as Remove
// from roster does it. The date he typed is trusted; the evening before, his
// platoon is warned so a wrong one is caught. Once per member and ORD date (an
// `ord` wb_audit row): an admin reopening his account sticks, and a corrected
// date is acted on when it comes.

const selfCamp = alias(camp, "ord_self_camp");
const selfSubunit = alias(subunit, "ord_self_subunit");

export interface OrdDue extends OrdMan {
  memberId: string;
  telegramUserId: number;
  ordDate: string;
  /** his roster person, if he has one that's still on the parade state */
  personId: string | null;
  subunitId: string | null;
}

/** Whoever's ORD is today or before and hasn't been dealt with for that date. */
export async function ordDue(today: string): Promise<OrdDue[]> {
  const rows = await db
    .select({
      memberId: wbMember.id,
      telegramUserId: wbMember.telegramUserId,
      ordDate: wbMember.ordDate,
      personId: person.id,
      personActive: person.active,
      rank: sql<string>`coalesce(${person.rank}, ${wbMember.selfRank}, '')`,
      name: sql<string>`coalesce(${person.name}, ${wbMember.selfName}, ${wbMember.fullName}, ${wbMember.tgName})`,
      campName: sql<string | null>`coalesce(${camp.name}, ${selfCamp.name})`,
      subunitId: sql<string | null>`coalesce(${subunit.id}, ${selfSubunit.id})`,
      subunitName: sql<string | null>`coalesce(${subunit.name}, ${selfSubunit.name})`,
    })
    .from(wbMember)
    .leftJoin(person, eq(person.id, wbMember.personId))
    .leftJoin(camp, eq(camp.id, person.campId))
    .leftJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(selfCamp, eq(selfCamp.id, wbMember.selfCampId))
    .leftJoin(selfSubunit, eq(selfSubunit.id, selfCamp.subunitId))
    .where(
      and(
        eq(wbMember.active, true),
        isNotNull(wbMember.registeredAt),
        lte(wbMember.ordDate, today),
        sql`not exists (select 1 from ${wbAuditTable} where ${wbAuditTable.action} = ${ORD_ACTION} and ${wbAuditTable.entityId} = ${wbMember.id}::text and ${wbAuditTable.after}->>'ordDate' = ${wbMember.ordDate}::text)`,
      ),
    )
    .orderBy(asc(wbMember.ordDate), asc(wbMember.id));
  return rows.map(({ personActive, ...r }) => ({ ...r, ordDate: r.ordDate!, personId: r.personId && personActive ? r.personId : null }));
}

/** Men on the roster whose ORD is tomorrow, for their platoon's warning. */
export async function ordTomorrow(tomorrow: string): Promise<(OrdMan & { subunitId: string })[]> {
  return db
    .select({ rank: person.rank, name: person.name, campName: camp.name, subunitId: subunit.id, subunitName: subunit.name })
    .from(wbMember)
    .innerJoin(person, and(eq(person.id, wbMember.personId), eq(person.active, true)))
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(and(eq(wbMember.active, true), isNotNull(wbMember.registeredAt), eq(wbMember.ordDate, tomorrow)))
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
}

export interface OrdResult {
  /** sent off: on the roster (removed) or not (account switched off) */
  retired: (OrdDue & { removed: boolean })[];
  kept: (OrdDue & { why: "bootstrap" | "last-admin" })[];
}

/**
 * The evening round's ORD step. Each man in his own transaction, so one
 * failure (logged, retried the next evening) doesn't hold up the rest. The DM
 * goes after the commit: a removal that failed never says "closes tonight".
 */
export async function retireOrd(courier: Courier, now: Date, today: string): Promise<OrdResult> {
  const out: OrdResult = { retired: [], kept: [] };
  const bootstrap = new Set(bootstrapAdminIds());
  for (const m of await ordDue(today)) {
    if (bootstrap.has(Number(m.telegramUserId))) {
      out.kept.push({ ...m, why: "bootstrap" });
      continue;
    }
    try {
      const done = await db.transaction(async (tx: Tx): Promise<{ kept: true } | { kept: false; cleanup: Cleanup | null }> => {
        if (await lastAdmin(tx, m.memberId)) return { kept: true };
        let cleanup: Cleanup | null = null;
        if (m.personId) {
          await ensureProjectorUser(tx);
          await removePersonCore(tx, PROJECTOR_USER.id, m.personId);
          cleanup = await cleanupWhereabouts(tx, m.personId, { memberId: null, label: "ORD", via: "SYSTEM", v1UserId: PROJECTOR_USER.id }, now);
        } else {
          await tx.update(wbMember).set({ active: false }).where(eq(wbMember.id, m.memberId));
          await wbAudit(tx, { memberId: null, via: "SYSTEM", action: "deactivate", entity: "wb_member", entityId: m.memberId, before: { active: true }, after: { active: false, reason: "ORD" } });
        }
        await wbAudit(tx, { memberId: null, via: "SYSTEM", action: ORD_ACTION, entity: "wb_member", entityId: m.memberId, after: { ordDate: m.ordDate, removed: !!m.personId, personId: m.personId } });
        return { kept: false, cleanup };
      });
      if (done.kept) {
        out.kept.push({ ...m, why: "last-admin" });
        continue;
      }
      if (done.cleanup) await redrawAfter(courier, done.cleanup);
      await courier.send({ telegramId: m.telegramUserId }, ordText(m, m.ordDate, today));
      out.retired.push({ ...m, removed: !!m.personId });
    } catch (e) {
      console.error(`wb ORD ${m.memberId}:`, e);
    }
  }
  if (out.retired.length) await syncQuietly();
  return out;
}
