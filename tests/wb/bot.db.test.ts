// The bot driven by a fake Telegram: updates go in through handleUpdate and
// every API call is captured instead of sent. Uses sabre_test; skipped if unreachable.

import { eq } from "drizzle-orm";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { person, subunit } from "@/lib/db/schema";
import { submit } from "@/lib/wb/decide";
import { wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { addDays, dateRange, todaySgt } from "@/lib/wb/domain/timeline";
import { createBot } from "@/lib/wb/telegram/bot";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "Sabre Coy",
  username: "sabrecoybot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
} as UserFromGetMe;

let calls: { method: string; payload: Record<string, unknown> }[] = [];
const bot = createBot("123:TEST", BOT_INFO);
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload: payload as Record<string, unknown> });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, result: { message_id: calls.length, date: 0, chat: { id: 0, type: "private" } } } as any;
});

let updateId = 0;
function command(text: string, opts: { from: number; chat?: { id: number; type: "private" | "supergroup"; title?: string }; topic?: number }): Update {
  const chat = opts.chat ?? { id: opts.from, type: "private" as const };
  const cmd = text.split(" ")[0];
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat,
      from: { id: opts.from, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: cmd.length }],
      ...(opts.topic ? { message_thread_id: opts.topic, is_topic_message: true } : {}),
    },
  } as Update;
}
async function send(u: Update) {
  calls = [];
  await bot.handleUpdate(u);
  return calls;
}
const lastText = (c: typeof calls) => String(c.at(-1)?.payload.text ?? "");

const GROUP = { id: -1001, type: "supergroup" as const, title: "PL6 Commanders" };

let reachable = true;
let pl6: string;
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("WB_APP_URL", "https://sabre.example");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
});
beforeEach(async () => {
  if (!reachable) return;
  await db.delete(wbConversation);
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function member(
  telegramUserId: number,
  grants: { role: "PS" | "PC" | "ADMIN" | "GC"; subunitId?: string }[] = [],
  personId: string | null = null,
) {
  const [m] = await db.insert(wbMember).values({ telegramUserId, tgName: "T", registeredAt: new Date(), personId, leaveLeft: 14 }).returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: g.role, subunitId: g.subunitId ?? null });
  return m;
}

describe("bot (fake Telegram)", () => {
  it("/start in a DM offers a web_app button to the Mini App", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await send(command("/start", { from: 10 }));
    expect(c).toHaveLength(1);
    expect(c[0].method).toBe("sendMessage");
    expect(c[0].payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open Sabre", web_app: { url: "https://sabre.example/tg" } }]] });
  });

  it("/start in a group uses a t.me link, in the same topic", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await send(command("/start@sabrecoybot", { from: 10, chat: GROUP, topic: 7 }));
    expect(c[0].payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open Sabre", url: "https://t.me/sabrecoybot/app" }]] });
    expect(c[0].payload.message_thread_id).toBe(7);
  });

  it("/whoami gives the chat, topic and user ids", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await send(command("/whoami", { from: 42, chat: GROUP, topic: 7 }));
    expect(lastText(c)).toBe("Chat id: -1001\nTopic (thread) id: 7\nYour Telegram id: 42");
  });

  it("/here refuses DMs, strangers, and people without a grant for that platoon", async (ctx) => {
    if (!reachable) ctx.skip();
    expect(lastText(await send(command("/here PLATOON 6", { from: 20 })))).toMatch(/commanders chat/);
    expect(lastText(await send(command("/here PLATOON 6", { from: 20, chat: GROUP })))).toMatch(/register first/);

    await member(21, [{ role: "PS", subunitId: pl6 }, { role: "GC" }]);
    expect(lastText(await send(command("/here PLATOON 5", { from: 21, chat: GROUP })))).toBe(
      "Only PLATOON 5's PC or PS (or a Sabre admin) can link this chat.",
    );
    expect(lastText(await send(command("/here", { from: 21, chat: GROUP })))).toMatch(/Which platoon\?/);
    expect(await db.select().from(wbCommanderChat)).toEqual([]);
  });

  it("/here links the chat for the platoon's PS, and says what it displaced", async (ctx) => {
    if (!reachable) ctx.skip();
    const ps = await member(30, [{ role: "PS", subunitId: pl6 }]);
    expect(lastText(await send(command("/here@sabrecoybot pl6", { from: 30, chat: GROUP })))).toBe(
      "✅ PLATOON 6's approval cards will come to this chat.",
    );
    let [row] = await db.select().from(wbCommanderChat);
    expect(row).toMatchObject({ subunitId: pl6, chatId: -1001, threadId: null, chatTitle: "PL6 Commanders", linkedBy: ps.id });

    expect(lastText(await send(command("/here PLATOON 6", { from: 30, chat: GROUP })))).toBe("This is already PLATOON 6's commanders chat.");

    // moved to a topic of another forum
    const forum = { id: -1002, type: "supergroup" as const, title: "Sabre Commanders" };
    expect(lastText(await send(command("/here PLATOON 6", { from: 30, chat: forum, topic: 99 })))).toBe(
      "✅ PLATOON 6's approval cards will come to this topic.\n\nIt replaces PL6 Commanders.",
    );
    const rows = await db.select().from(wbCommanderChat);
    expect(rows).toHaveLength(1);
    [row] = rows;
    expect(row).toMatchObject({ chatId: -1002, threadId: 99 });
    const audits = await db.select().from(wbAudit).where(eq(wbAudit.entity, "wb_commander_chat"));
    expect(audits.map((a) => [a.action, a.via])).toEqual([["link-chat", "BOT"], ["link-chat", "BOT"]]);
  });

  it("an ADMIN can link any subunit, including COY HQ", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(40, [{ role: "ADMIN" }]);
    expect(lastText(await send(command("/here HQ", { from: 40, chat: { id: -1003, type: "supergroup", title: "HQ" } })))).toBe(
      "✅ COY HQ's approval cards will come to this chat.",
    );
  });

  it("a deactivated member can't use /here", async (ctx) => {
    if (!reachable) ctx.skip();
    const m = await member(50, [{ role: "ADMIN" }]);
    await db.update(wbMember).set({ active: false }).where(eq(wbMember.id, m.id));
    expect(lastText(await send(command("/here PLATOON 6", { from: 50, chat: GROUP })))).toMatch(/register first/);
  });
});

// ------------------------------------------------------------------ cards and decisions

function tap(data: string, opts: { from: number; messageId: number; chat?: typeof GROUP; topic?: number }): Update {
  return {
    update_id: ++updateId,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: opts.from, is_bot: false, first_name: "T" },
      chat_instance: "ci",
      data,
      message: {
        message_id: opts.messageId,
        date: 0,
        chat: opts.chat ?? GROUP,
        text: "card",
        ...(opts.topic ? { message_thread_id: opts.topic, is_topic_message: true } : {}),
      },
    },
  } as Update;
}
function reply(text: string, opts: { from: number; to: number; topic?: number }): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: 1000 + updateId,
      date: Math.floor(Date.now() / 1000),
      chat: GROUP,
      from: { id: opts.from, is_bot: false, first_name: "T" },
      text,
      reply_to_message: { message_id: opts.to, date: 0, chat: GROUP, text: "prompt" },
      ...(opts.topic ? { message_thread_id: opts.topic, is_topic_message: true } : {}),
    },
  } as Update;
}
const answerOf = (c: typeof calls) => c.find((x) => x.method === "answerCallbackQuery")?.payload;

describe("bot: approval cards (fake Telegram)", () => {
  const TROOPER = 61;
  const PS = 62;
  let recordId: string;
  let cardMessage: number;

  /** PTE IRFAN applies for AL; the card goes to PLATOON 6's topic. */
  async function pending() {
    const [irfan] = await db.select({ id: person.id }).from(person).where(eq(person.name, "IRFAN"));
    const [chunHei] = await db.select({ id: person.id }).from(person).where(eq(person.name, "CHUN HEI"));
    const trooper = await member(TROOPER, [], irfan.id);
    await member(PS, [{ role: "PS", subunitId: pl6 }], chunHei.id);
    await db.insert(wbCommanderChat).values({ subunitId: pl6, chatId: GROUP.id, threadId: 7, chatTitle: GROUP.title });
    calls = [];
    const d = addDays(todaySgt(), 10);
    const { records, delivery } = await submit(
      { api: bot.api, botUsername: "sabrecoybot" },
      { id: trooper.id, personId: irfan.id, grants: [] },
      [{ personId: irfan.id, memberId: trooper.id, kind: "AL", ...dateRange(d, d), endAt: dateRange(d, d).endAt!, absent: true, leaveDays: 1, detail: "AL @ SINGAPORE", createdVia: "SELF" }],
      "MINIAPP",
    );
    expect(delivery).toBe("sent");
    recordId = records[0].id;
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ chat_id: GROUP.id, message_thread_id: 7 });
    cardMessage = (await db.select().from(wbCard))[0].messageId;
  }

  it("a tap from someone without a grant gets an alert and changes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await pending();
    await member(63, [{ role: "GC" }]); // in the chat, but a GC
    const c = await send(tap(`d:${recordId}:a`, { from: 63, messageId: cardMessage, topic: 7 }));
    expect(answerOf(c)).toEqual({ callback_query_id: expect.any(String), text: "Only PLATOON 6's PC or PS can decide this.", show_alert: true });
    expect(c.filter((x) => x.method === "editMessageText")).toEqual([]);
    expect((await db.select().from(wbRecord))[0].state).toBe("PENDING");
    // and a stranger isn't registered
    expect(answerOf(await send(tap(`d:${recordId}:a`, { from: 99, messageId: cardMessage })))).toMatchObject({ text: "Open Sabre and register first.", show_alert: true });
  });

  it("approve: the card is edited with Undo, the trooper is told, leave is spent", async (ctx) => {
    if (!reachable) ctx.skip();
    await pending();
    const c = await send(tap(`d:${recordId}:a`, { from: PS, messageId: cardMessage, topic: 7 }));
    expect(answerOf(c)).toMatchObject({ text: "Approved" });
    const edit = c.find((x) => x.method === "editMessageText")!.payload;
    expect(edit).toMatchObject({ chat_id: GROUP.id, message_id: cardMessage });
    expect(String(edit.text)).toMatch(/✅ Approved by LCP CHUN HEI$/);
    expect(edit.reply_markup).toEqual({
      inline_keyboard: [[{ text: "↩ Undo", callback_data: `d:${recordId}:u` }], [{ text: "Open", url: `https://t.me/sabrecoybot/app?startapp=records__${recordId}` }]],
    });
    expect(c.find((x) => x.method === "sendMessage")!.payload).toMatchObject({ chat_id: TROOPER, text: expect.stringMatching(/^✅ Approved by LCP CHUN HEI/) });
    expect((await db.select().from(wbMember).where(eq(wbMember.telegramUserId, TROOPER)))[0].leaveLeft).toBe(13);
    const [a] = await db.select().from(wbAudit).where(eq(wbAudit.action, "approve"));
    expect(a.via).toBe("BOT");

    // a second tap is told it's decided
    expect(answerOf(await send(tap(`d:${recordId}:r`, { from: PS, messageId: cardMessage })))).toMatchObject({ text: "Already approved by LCP CHUN HEI.", show_alert: true });
  });

  it("undo works for ten minutes, then is refused", async (ctx) => {
    if (!reachable) ctx.skip();
    await pending();
    await send(tap(`d:${recordId}:a`, { from: PS, messageId: cardMessage }));
    const c = await send(tap(`d:${recordId}:u`, { from: PS, messageId: cardMessage }));
    expect(answerOf(c)).toMatchObject({ text: "Undone" });
    expect(String(c.find((x) => x.method === "editMessageText")!.payload.text)).toMatch(/^⏳ Approval needed/);

    await send(tap(`d:${recordId}:a`, { from: PS, messageId: cardMessage }));
    await db.update(wbRecord).set({ decidedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(wbRecord.id, recordId));
    const late = await send(tap(`d:${recordId}:u`, { from: PS, messageId: cardMessage }));
    expect(answerOf(late)).toMatchObject({ text: "Too late to undo. Tell them yourself instead.", show_alert: true });
    expect((await db.select().from(wbRecord))[0].state).toBe("APPROVED");
  });

  it("reject, then Say why: a force_reply prompt in the topic, and the reply becomes the note", async (ctx) => {
    if (!reachable) ctx.skip();
    await pending();
    const rejected = await send(tap(`d:${recordId}:r`, { from: PS, messageId: cardMessage, topic: 7 }));
    expect((rejected.find((x) => x.method === "editMessageText")!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard[0].map((b) => b.text)).toEqual([
      "✍️ Say why",
      "↩ Undo",
    ]);

    // someone else can't say why
    await member(64, [{ role: "PC", subunitId: pl6 }]);
    expect(answerOf(await send(tap(`d:${recordId}:w`, { from: 64, messageId: cardMessage, topic: 7 })))).toMatchObject({ show_alert: true });

    const c = await send(tap(`d:${recordId}:w`, { from: PS, messageId: cardMessage, topic: 7 }));
    const prompt = c.find((x) => x.method === "sendMessage")!;
    expect(prompt.payload).toMatchObject({
      chat_id: GROUP.id,
      message_thread_id: 7,
      text: expect.stringMatching(/^LCP CHUN HEI, why did you turn down PTE IRFAN\?/),
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Why not?" },
      reply_parameters: { message_id: cardMessage, allow_sending_without_reply: true },
    });
    const promptId = calls.indexOf(prompt) + 1; // the fake's message_id is the call count
    expect(await db.select().from(wbConversation)).toMatchObject([{ telegramUserId: PS, chatId: GROUP.id, flow: "SAY_WHY", ctx: { recordId, promptMessageId: promptId } }]);

    // a reply to some other message is ignored
    expect(await send(reply("hello", { from: PS, to: 12345, topic: 7 }))).toEqual([]);

    const r = await send(reply("Camp is short that weekend", { from: PS, to: promptId, topic: 7 }));
    expect((await db.select().from(wbRecord))[0].decisionNote).toBe("Camp is short that weekend");
    expect(String(r.find((x) => x.method === "editMessageText")!.payload.text)).toMatch(/Why: Camp is short that weekend$/);
    expect(r.find((x) => x.method === "sendMessage" && x.payload.chat_id === TROOPER)!.payload.text).toMatch(/^💬 Why LCP CHUN HEI said no/);
    expect(r.at(-1)!.payload).toMatchObject({ chat_id: GROUP.id, text: "✅ Sent to PTE IRFAN.", message_thread_id: 7 });
    expect(await db.select().from(wbConversation)).toEqual([]);
  });

  it("a Say why reply after ten minutes is dropped", async (ctx) => {
    if (!reachable) ctx.skip();
    await pending();
    await send(tap(`d:${recordId}:r`, { from: PS, messageId: cardMessage }));
    await send(tap(`d:${recordId}:w`, { from: PS, messageId: cardMessage }));
    const [conv] = await db.select().from(wbConversation);
    await db.update(wbConversation).set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) });
    const r = await send(reply("late", { from: PS, to: (conv.ctx as { promptMessageId: number }).promptMessageId }));
    expect(lastText(r)).toMatch(/more than ten minutes ago/);
    expect((await db.select().from(wbRecord))[0].decisionNote).toBeNull();
  });

  it("quick commands open the right screen", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await send(command("/leave", { from: 70 }));
    expect(c[0].payload.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "🌴 Annual leave", web_app: { url: "https://sabre.example/tg/apply/al" } }],
        [{ text: "✈️ Overseas leave", web_app: { url: "https://sabre.example/tg/apply/ol" } }],
      ],
    });
    expect((await send(command("/me", { from: 70 })))[0].payload.reply_markup).toEqual({
      inline_keyboard: [[{ text: "📋 My records", web_app: { url: "https://sabre.example/tg/records" } }]],
    });
  });
});
