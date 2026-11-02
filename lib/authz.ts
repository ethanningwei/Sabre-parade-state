import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { camp, duty, person } from "@/lib/db/schema";
import { sessionUser } from "@/lib/session";
import { paradeReach } from "@/lib/wb/parade-scope";

export type Role = "pending" | "guardcomm" | "admin";

export interface Viewer {
  id: string;
  name: string;
  role: Role;
  subunitId: string | null;
  active: boolean;
  /**
   * Opened from the Mini App without company-wide reach (whereabouts): a
   * guardcomm who edits only these platoons and camps.
   */
  scope?: { subunitIds: readonly string[]; campIds: readonly string[] };
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

/** The signed-in user, re-read from the DB so role/scope changes apply immediately. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const row = await sessionUser();
  if (!row) return null;
  const viewer: Viewer = { id: row.id, name: row.name, role: row.role, subunitId: row.subunitId, active: row.active };
  // null with FEATURE_WHEREABOUTS off: v1 unchanged
  const reach = await paradeReach(row.id);
  if (!reach || reach === "company") return viewer;
  // one platoon only: his "home" platoon, as a v1 guardcomm's
  const subunitId = reach.subunitIds.length === 1 && !reach.campIds.length ? reach.subunitIds[0] : null;
  return { ...viewer, role: viewer.role === "admin" ? "guardcomm" : viewer.role, subunitId, scope: reach };
});

/** For pages: signed in and active — otherwise back to the login page. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "pending" || !viewer.active) redirect("/login");
  return viewer;
}

export async function requireAdminPage(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") redirect("/");
  return viewer;
}

/** For server actions: throws instead of redirecting. */
export async function actionViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new ForbiddenError("Please sign in again.");
  if (viewer.role === "pending" || !viewer.active) throw new ForbiddenError("Your account isn't approved yet.");
  return viewer;
}

export async function actionAdmin(): Promise<Viewer> {
  const viewer = await actionViewer();
  if (viewer.role !== "admin") throw new ForbiddenError("Only admins can do that.");
  return viewer;
}

/** The whole platoon: an admin, its guardcomm, or a scope over it. */
export function canEditSubunit(viewer: Viewer, subunitId: string): boolean {
  if (viewer.role === "admin") return true;
  return viewer.role === "guardcomm" && (viewer.subunitId === subunitId || !!viewer.scope?.subunitIds.includes(subunitId));
}

/** One camp: as its platoon, or a scope over that camp alone (a GC's). */
export function canEditCamp(viewer: Viewer, c: { subunitId: string; campId: string }): boolean {
  return canEditSubunit(viewer, c.subunitId) || (viewer.role === "guardcomm" && !!viewer.scope?.campIds.includes(c.campId));
}

function scopeRefusal(viewer: Viewer): string {
  const s = viewer.scope;
  if (!s) return "You can only edit your own platoon.";
  if (!s.subunitIds.length && !s.campIds.length) return "You can only view the parade state.";
  if (!s.subunitIds.length) return s.campIds.length > 1 ? "You can only edit your own camps." : "You can only edit your own camp.";
  return s.campIds.length || s.subunitIds.length > 1 ? "You can only edit your own platoons and camps." : "You can only edit your own platoon.";
}

function assertCamp(viewer: Viewer, row: { subunitId: string; campId: string } | undefined) {
  if (!row) throw new ForbiddenError("Not found.");
  if (!canEditCamp(viewer, row)) throw new ForbiddenError(scopeRefusal(viewer));
}

export async function assertCanEditCamp(viewer: Viewer, campId: string) {
  const [row] = await db.select({ subunitId: camp.subunitId, campId: camp.id }).from(camp).where(eq(camp.id, campId));
  assertCamp(viewer, row);
}

export async function assertCanEditPerson(viewer: Viewer, personId: string) {
  const [row] = await db
    .select({ subunitId: camp.subunitId, campId: camp.id })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(eq(person.id, personId));
  assertCamp(viewer, row);
}

export async function assertCanEditDuty(viewer: Viewer, dutyId: string) {
  const [row] = await db
    .select({ subunitId: camp.subunitId, campId: camp.id })
    .from(duty)
    .innerJoin(camp, eq(camp.id, duty.campId))
    .where(eq(duty.id, dutyId));
  assertCamp(viewer, row);
}
