import type { db } from "@/lib/db";
import { wbAudit as wbAuditTable } from "@/lib/wb/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WbAuditEntry {
  /** wb_member.id of who did it; null for the system */
  memberId: string | null;
  /** WEB: the v1 web app (its user's name in `after.by`) */
  via: "MINIAPP" | "BOT" | "SYSTEM" | "WEB";
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Whereabouts' own audit trail (wb_audit). v1's audit_log is keyed to v1 users, so it isn't used. */
export async function wbAudit(tx: Tx | typeof db, e: WbAuditEntry) {
  await tx.insert(wbAuditTable).values({
    memberId: e.memberId,
    via: e.via,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  });
}
