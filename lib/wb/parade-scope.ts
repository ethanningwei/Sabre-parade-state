import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSession } from "@/lib/db/schema";
import { isEnabled } from "@/lib/flags";
import { passwordSignInEnabled, sentSessionTokens } from "@/lib/session";
import { wbAudit, wbGrant, wbMember, wbParadeSession } from "@/lib/wb/db/schema";
import { reach, type GrantRow, type Reach } from "@/lib/wb/domain/access";

// How far a v1 session's edits reach (the user, 2026-11-02): a session opened
// from the Mini App's "Parade state" edits only the men in that member's
// parade-state reach, so a GC of one camp can't correct another camp's. v1's
// authz (getViewer) asks; nothing here runs with FEATURE_WHEREABOUTS off.

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** The member who opened this v1 session from the Mini App, if it was one. */
async function openedBy(userId: string): Promise<string | null> {
  const hashes = (await sentSessionTokens()).map(sha256);
  if (!hashes.length) return null;
  const [row] = await db
    .select({ memberId: wbParadeSession.memberId })
    .from(wbParadeSession)
    .innerJoin(appSession, eq(appSession.tokenHash, wbParadeSession.tokenHash))
    .where(and(inArray(wbParadeSession.tokenHash, hashes), eq(appSession.userId, userId), gte(appSession.expiresAt, new Date())));
  return row?.memberId ?? null;
}

/** A session opened before wb_parade_session: the last member who opened the parade state as this v1 user. */
async function lastOpenedBy(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ memberId: wbAudit.memberId })
    .from(wbAudit)
    .where(and(eq(wbAudit.action, "open-parade-state"), eq(wbAudit.entity, "user"), eq(wbAudit.entityId, userId)))
    .orderBy(desc(wbAudit.at))
    .limit(1);
  return row?.memberId ?? null;
}

/**
 * null: no limit beyond v1's own (the flag off, or a shared-password sign-in).
 * Otherwise the member's parade-state reach, re-read each request so grant
 * changes apply at once; an inactive member, or none, reaches nothing.
 */
export async function paradeReach(userId: string): Promise<Reach | null> {
  if (!isEnabled("WHEREABOUTS")) return null;
  let memberId = await openedBy(userId);
  if (!memberId) {
    // the shared password is full access, as ever
    if (passwordSignInEnabled()) return null;
    // with it off, every live session came from the Mini App
    memberId = await lastOpenedBy(userId);
  }
  if (!memberId) return { subunitIds: [], campIds: [] };
  const grants: GrantRow[] = await db
    .select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId })
    .from(wbGrant)
    .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
    .where(and(eq(wbGrant.memberId, memberId), eq(wbMember.active, true)));
  return reach({ grants }, "parade");
}
