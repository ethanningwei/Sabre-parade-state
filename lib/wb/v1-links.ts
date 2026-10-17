import "server-only";
import { getMember } from "@/lib/wb/auth";
import { isWaiting } from "@/lib/wb/domain/roster-flow";
import { canDecide, canForecast, type Where } from "@/lib/wb/domain/rules";
import { fromTelegram } from "@/lib/wb/from-telegram";

// The way from v1's screens into the Mini App, for a v1 session started by its
// "Parade state" (agreed with the user 2026-10-17). Null with the flag off or
// outside Telegram, without reading anything else, so v1 is unchanged then.
// Plain <a> links: the Mini App has its own layout, so they're full loads.

export interface SabreLinks {
  /** Manpower narrowed to this camp, if they may see it */
  manpower: string | null;
  /** whether they may open Person history for its men */
  history: boolean;
}

/** v1's camp screen. */
export async function sabreLinksForCamp(where: Where): Promise<SabreLinks | null> {
  if (!(await fromTelegram())) return null;
  const member = await getMember();
  if (!member?.registeredAt || isWaiting(member)) return null;
  return {
    manpower: canForecast(member.grants, where) ? `/tg/manpower?camp=${where.campId}` : null,
    history: canDecide(member.grants, where),
  };
}
