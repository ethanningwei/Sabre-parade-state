import { UserError } from "@/lib/errors";
import type { GrantRow } from "@/lib/wb/domain/access";

// What every whereabouts write shares: who is acting and through what, the
// Refusal that rolls a write back with a message, and how a card went. The
// write itself is lib/wb/write.ts.

export type Via = "BOT" | "MINIAPP";

/** Who is acting: a member, their roster person (if linked), their grants, and whether they've registered. */
export interface Actor {
  id: string;
  personId: string | null;
  grants: readonly GrantRow[];
  registered: boolean;
}

/** The Actor for a signed-in member (the Mini App's session, or the bot's lookup by Telegram id). */
export const actorOf = (m: { id: string; personId: string | null; grants: readonly GrantRow[]; registeredAt: Date | null }): Actor => ({
  id: m.id,
  personId: m.personId,
  grants: m.grants,
  registered: !!m.registeredAt,
});

/**
 * Why a write didn't happen, for whoever tried. Thrown inside a write to roll
 * it back. A v1 UserError (thrown by lib/core inside a write) is one too, and
 * a server action's run() shows either as the message.
 */
export class Refusal extends UserError {}

/** How a card went: posted, nowhere to post it (no commanders chat linked), or Telegram failed. */
export type Delivery = "sent" | "no-chat" | "failed";
