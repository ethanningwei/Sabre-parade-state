import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { actorOf, type Via } from "@/lib/wb/core";
import { wbGrant, wbMember } from "@/lib/wb/db/schema";
import { addDays, todaySgt } from "@/lib/wb/domain/timeline";
import type { Acting } from "@/lib/wb/write";

// What DB tests of whereabouts writes share: members with grants, and the
// Acting a Write takes for one of them. A Write is called directly with the
// recording Courier (recording-courier.ts): no session cookie, no Telegram.

export type Role = "PS" | "PC" | "GC" | "SC" | "OC" | "2IC" | "CSM" | "ASA" | "ADMIN";
export type GrantSpec = { role: Role; subunitId?: string; campId?: string };

/** A registered member, on the roster as `personId` (or not), with these grants. */
export async function member(tgId: number, personId: string | null, grants: GrantSpec[] = [], extra: Partial<typeof wbMember.$inferInsert> = {}) {
  const [m] = await db
    .insert(wbMember)
    .values({ telegramUserId: tgId, tgName: `T${tgId}`, personId, registeredAt: new Date(), leaveLeft: 14, source: personId ? "ROSTER" : "SELF", ...extra })
    .returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: g.role, subunitId: g.subunitId ?? null, campId: g.campId ?? null });
  return m;
}

/** That Telegram user acting, as the bot or the Mini App would hand them to a Write. */
export async function acting(tgId: number, via: Via = "MINIAPP"): Promise<Acting> {
  const [m] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, tgId));
  const grants = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, m.id));
  return { actor: actorOf({ ...m, grants }), via };
}

export const memberId = async (tgId: number) => (await db.select({ id: wbMember.id }).from(wbMember).where(eq(wbMember.telegramUserId, tgId)))[0].id;

/** Days from today, SGT. */
export const day = (n: number) => addDays(todaySgt(), n);

/** Unwrap a Write's Outcome, failing the test with its refusal. */
export function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!res.ok) throw new Error(`refused: ${res.error}`);
  return res.value;
}

export async function reachable(): Promise<boolean> {
  try {
    await db.execute("select 1");
    return true;
  } catch {
    return false;
  }
}
