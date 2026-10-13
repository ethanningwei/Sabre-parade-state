import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { db } from "@/lib/db";
import { subunit } from "@/lib/db/schema";
import { bootstrapAdminIds } from "@/lib/wb/auth";
import type { Delivery } from "@/lib/wb/core";
import { wbCard, wbCommanderChat, wbMember, wbRfCard } from "@/lib/wb/db/schema";
import { rfButtons, rfCardText, type RfRequestView } from "@/lib/wb/domain/rf";
import { isOutcome } from "@/lib/wb/domain/rules";
import { manningFor } from "@/lib/wb/forecast-data";
import { outcomeBatch, recordView, type RecordView } from "@/lib/wb/records";
import { rfView } from "@/lib/wb/rf-data";
import { cardKeyboard, cardText, outcomeCardText, outcomeKeyboard } from "./cards";
import { miniAppLink } from "./links";
import { outbound, type Outbound } from "./outbound";

// Everything whereabouts says on Telegram on its own initiative goes through
// here. Callers name who should hear it (a platoon's commanders chat, a man,
// the admins) or which tracked card changed; the Courier finds the chat and
// topic, renders and remembers cards, redraws every copy, and swallows
// Telegram's failures. A send never throws: by the time anything is sent the
// change is committed, and a Telegram failure never undoes it.
//
// Replies to a tap (answerCallbackQuery, Say why's prompt, the ONENS button
// edit) stay in bot.ts on the update's ctx; photo.ts stores photos itself.

export type Audience =
  /** a platoon's commanders chat (its topic, if set), by subunit id */
  | { platoon: string }
  /** a roster person's own DM, if he has an account */
  | { person: string }
  /** a DM to an id already in hand (a view's ownerTelegramId, a request's raiser) */
  | { telegramId: number | null }
  /** WB_ADMIN_TELEGRAM_IDS */
  | { admins: true };

/** A Mini App route (a link) or callback data. Same shape as domain/rf's RfButton. */
export interface Button {
  text: string;
  route?: string;
  data?: string;
}

/** A tracked card: posted once, remembered, redrawn in every copy. Pass the view when it's already loaded. */
export type CardKey = { record: string | RecordView } | { rf: string | RfRequestView };

export interface Courier {
  /** How many messages went out (0: nobody to send to, offline, or Telegram failed). Never throws. */
  send(to: Audience, text: string, buttons?: Button[][]): Promise<number>;
  /**
   * Post a card where its kind goes and remember each copy. A record or an
   * outcome: its platoon's commanders chat. An RF request: the camp's
   * platoon and COY HQ (each chat once), and the raiser's own copy.
   */
  postCard(card: CardKey, opts?: { replaces?: readonly string[] }): Promise<{ delivery: Delivery; chats: number }>;
  /** Bring every copy of a card up to its current state. */
  redraw(card: CardKey): Promise<void>;
}

const isNotModified = (e: unknown) => String((e as Error)?.message ?? e).includes("message is not modified");

/** The Courier over a bot's API. null: Telegram can't be reached, so routing still runs and nothing is sent. */
export function courierOf(out: Outbound | null): Courier {
  const markup = (rows: readonly Button[][]): InlineKeyboardMarkup => ({
    inline_keyboard: rows.map((row) =>
      row.map((b): InlineKeyboardButton => (b.route !== undefined ? { text: b.text, url: miniAppLink(out!.botUsername, b.route) } : { text: b.text, callback_data: b.data! })),
    ),
  });

  async function dm(telegramId: number | null, text: string, buttons?: Button[][]): Promise<number> {
    if (!out || !telegramId) return 0;
    try {
      await out.api.sendMessage(telegramId, text, buttons ? { reply_markup: markup(buttons) } : undefined);
      return 1;
    } catch (e) {
      console.error("wb dm:", e);
      return 0;
    }
  }

  async function toChat(chat: ChatRow, text: string, reply_markup?: InlineKeyboardMarkup): Promise<number> {
    const msg = await out!.api.sendMessage(chat.chatId, text, { message_thread_id: chat.threadId ?? undefined, ...(reply_markup ? { reply_markup } : {}) });
    return msg.message_id;
  }

  async function send(to: Audience, text: string, buttons?: Button[][]): Promise<number> {
    if ("telegramId" in to) return dm(to.telegramId, text, buttons);
    if ("person" in to) return dm(await telegramOf(to.person), text, buttons);
    if ("admins" in to) {
      let sent = 0;
      for (const id of bootstrapAdminIds()) sent += await dm(id, text, buttons);
      return sent;
    }
    const [chat] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, to.platoon));
    if (!chat || !out) return 0;
    try {
      await toChat(chat, text, buttons ? markup(buttons) : undefined);
      return 1;
    } catch (e) {
      console.error("wb chat:", e);
      return 0;
    }
  }

  async function postRecord(r: RecordView, replaces?: readonly string[]): Promise<{ delivery: Delivery; chats: number }> {
    const batch = isOutcome(r.kind) ? await outcomeBatch(r) : null;
    const head = batch?.[0] ?? r;
    const [chat] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, head.subunitId));
    if (!chat) return { delivery: "no-chat", chats: 0 };
    if (!out) return { delivery: "failed", chats: 1 };
    try {
      const messageId = batch
        ? await toChat(chat, outcomeCardText(batch, { replaces }), outcomeKeyboard(batch, out.botUsername))
        : await toChat(chat, cardText(r, await manningFor(r)), cardKeyboard(r, out.botUsername));
      await db.insert(wbCard).values({ recordId: head.id, chatId: chat.chatId, threadId: chat.threadId, messageId });
      return { delivery: "sent", chats: 1 };
    } catch (e) {
      console.error("wb card send:", e);
      return { delivery: "failed", chats: 1 };
    }
  }

  async function postRf(r: RfRequestView | null): Promise<{ delivery: Delivery; chats: number }> {
    if (!r) return { delivery: "failed", chats: 0 };
    const chats = await rfDestinations(r.subunitId);
    if (!out) return { delivery: chats.length ? "failed" : "no-chat", chats: chats.length };
    let sent = 0;
    for (const chat of chats) {
      try {
        const messageId = await toChat(chat, rfCardText(r), markup(rfButtons(r, false)));
        await db.insert(wbRfCard).values({ rfRequestId: r.id, chatId: chat.chatId, threadId: chat.threadId, messageId });
        sent++;
      } catch (e) {
        console.error("wb rf card send:", e);
      }
    }
    if (r.raisedByTelegramId) {
      try {
        const msg = await out.api.sendMessage(r.raisedByTelegramId, rfCardText(r), { reply_markup: markup(rfButtons(r, true)) });
        await db.insert(wbRfCard).values({ rfRequestId: r.id, chatId: r.raisedByTelegramId, threadId: null, messageId: msg.message_id, own: true });
      } catch (e) {
        console.error("wb rf own copy:", e);
      }
    }
    return { delivery: !chats.length ? "no-chat" : sent ? "sent" : "failed", chats: chats.length };
  }

  async function edit(chatId: number, messageId: number, text: string, reply_markup: InlineKeyboardMarkup) {
    try {
      await out!.api.editMessageText(chatId, messageId, text, { reply_markup });
    } catch (e) {
      if (!isNotModified(e)) console.error("wb card edit:", e);
    }
  }

  async function redrawRecord(r: RecordView): Promise<void> {
    const batch = isOutcome(r.kind) ? await outcomeBatch(r) : [r];
    const cards = await db.select().from(wbCard).where(inArray(wbCard.recordId, batch.map((x) => x.id)));
    if (!cards.length) return;
    // recomputed on every redraw: approving or undoing changes the camp's numbers
    const text = isOutcome(r.kind) ? outcomeCardText(batch) : cardText(r, await manningFor(r));
    const reply_markup = isOutcome(r.kind) ? outcomeKeyboard(batch, out!.botUsername) : cardKeyboard(r, out!.botUsername);
    for (const c of cards) await edit(c.chatId, c.messageId, text, reply_markup);
  }

  async function redrawRf(r: RfRequestView | null): Promise<void> {
    if (!r) return;
    const cards = await db.select().from(wbRfCard).where(eq(wbRfCard.rfRequestId, r.id));
    const text = rfCardText(r);
    for (const c of cards) await edit(c.chatId, c.messageId, text, markup(rfButtons(r, c.own)));
  }

  const viewOf = async (record: string | RecordView) => (typeof record === "string" ? recordView(record) : record);
  const rfOf = async (request: string | RfRequestView) => (typeof request === "string" ? rfView(request) : request);

  return {
    send,
    async postCard(card, opts = {}) {
      if ("rf" in card) return postRf(await rfOf(card.rf));
      const r = await viewOf(card.record);
      return r ? postRecord(r, opts.replaces) : { delivery: "failed", chats: 0 };
    },
    async redraw(card) {
      if (!out) return;
      if ("rf" in card) return redrawRf(await rfOf(card.rf));
      const r = await viewOf(card.record);
      if (r) await redrawRecord(r);
    },
  };
}

/** The Courier for a server action or route: the bot's API, or an offline Courier if the bot can't be reached. */
export async function courier(): Promise<Courier> {
  try {
    return courierOf(await outbound());
  } catch (e) {
    console.error("wb outbound:", e);
    return courierOf(null);
  }
}

// ------------------------------------------------------------------ routing

type ChatRow = typeof wbCommanderChat.$inferSelect;

/** The Telegram account of a roster person, if he has one. */
async function telegramOf(personId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: wbMember.telegramUserId })
    .from(wbMember)
    .where(and(eq(wbMember.personId, personId), eq(wbMember.active, true)));
  return row?.id ?? null;
}

/** Where a request's cards go: the camp's own platoon's commanders chat and COY HQ's (decided 2026-10-13), each once. */
async function rfDestinations(subunitId: string): Promise<ChatRow[]> {
  const hq = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.isHq, true));
  const chats = await db
    .select()
    .from(wbCommanderChat)
    .where(inArray(wbCommanderChat.subunitId, [subunitId, ...hq.map((h) => h.id)]));
  const seen = new Set<string>();
  // the camp's own platoon first
  return chats
    .sort((a, b) => (a.subunitId === subunitId ? -1 : 0) - (b.subunitId === subunitId ? -1 : 0))
    .filter((c) => {
      const key = `${c.chatId}:${c.threadId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
