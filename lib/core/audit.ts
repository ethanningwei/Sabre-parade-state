// The v1 audit trail, written by the server actions (as the signed-in user)
// and by the cores they share with the whereabouts projector (as its own user).

import type { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function writeAudit(
  tx: Tx | typeof db,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await tx.insert(auditLog).values({
    userId,
    action,
    entity,
    entityId,
    before: before ?? null,
    after: after ?? null,
  });
}
