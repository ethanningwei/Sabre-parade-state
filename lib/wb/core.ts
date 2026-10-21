import "server-only";
import { db } from "@/lib/db";
import type { GrantRow } from "@/lib/wb/domain/access";
import { syncQuietly } from "@/lib/wb/projection";
import type { Db } from "@/lib/wb/records";

// What every whereabouts write shares: who is acting and through what, one
// transaction that a Refusal rolls back with a message, and how a card went.

export type Via = "BOT" | "MINIAPP";

/** Who is acting: a member, their roster person (if linked) and their grants. */
export interface Actor {
  id: string;
  personId: string | null;
  grants: readonly GrantRow[];
}

/** Thrown inside a transaction to roll it back with a message for the user. */
export class Refusal extends Error {}

/** Every whereabouts write. Once it commits, the projector brings the parade state in line (FEATURE_PROJECTION). */
export async function inTx<T>(fn: (tx: Db) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let value: T;
  try {
    value = await db.transaction(fn);
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
  await syncQuietly();
  return { ok: true, value };
}

/** How a card went: posted, nowhere to post it (no commanders chat linked), or Telegram failed. */
export type Delivery = "sent" | "no-chat" | "failed";
