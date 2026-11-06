import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, type Viewer } from "@/lib/authz";
import { writeAudit, type Tx } from "@/lib/core/audit";
import type { db } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { LOCKED_TEXT, projectionLive } from "@/lib/wb/projection";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export { UserError };

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** While Sabre owns the parade state (projection on), the web app can't edit it: it all goes through the Mini App (the user, 2026-11-06). */
export async function assertParadeOpen() {
  if (await projectionLive()) throw new UserError(LOCKED_TEXT);
}

export async function audit(
  tx: Tx | typeof db,
  viewer: Viewer,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await writeAudit(tx, viewer.id, action, entity, entityId, before, after);
}

export const zDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .nullable()
  .transform((v) => v || null);

export const zTime = z
  .string()
  .regex(/^([01]\d|2[0-3])[0-5]\d$/, "Times must be HHMM, e.g. 2100")
  .nullable()
  .or(z.literal("").transform(() => null));
