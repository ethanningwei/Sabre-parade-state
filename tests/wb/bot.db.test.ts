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
import { courierOf } from "@/lib/wb/telegram/courier";
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
      courierOf({ api: bot.api, botUsername: "sabrecoybot" }),
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

    // a stale Say why button: the reason is in, so it can't be overwritten (2026-10-21)
    expect(answerOf(await send(tap(`d:${recordId}:w`, { from: PS, messageId: cardMessage, topic: 7 })))).toMatchObject({ show_alert: true, text: "You've already said why." });
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

// ------------------------------------------------------------------ Phase 3: the evening round and ONENS

describe("evening round (fake Telegram)", () => {
  const TROOPER = 81;
  const PS = 82;
  const ADMIN = 83;
  let irfan: string;
  let trooperId: string;

  async function people() {
    [{ id: irfan }] = await db.select({ id: person.id }).from(person).where(eq(person.name, "IRFAN"));
    const [chunHei] = await db.select({ id: person.id }).from(person).where(eq(person.name, "CHUN HEI"));
    trooperId = (await member(TROOPER, [], irfan)).id;
    await member(PS, [{ role: "PS", subunitId: pl6 }], chunHei.id);
    await db.insert(wbCommanderChat).values({ subunitId: pl6, chatId: GROUP.id, threadId: 7, chatTitle: GROUP.title });
  }
  const rec = (over: Partial<typeof wbRecord.$inferInsert>) =>
    db
      .insert(wbRecord)
      .values({ personId: irfan, memberId: trooperId, kind: "MC", absent: true, state: "RECORDED", createdVia: "SELF", ...dateRange(todaySgt(), todaySgt()), ...over })
      .returning()
      .then((r) => r[0]);
  const out = () => courierOf({ api: bot.api, botUsername: "sabrecoybot" });

  it("sends each reminder once, one digest per platoon, and a heartbeat last", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", String(ADMIN));
    await people();
    const today = todaySgt();
    await rec({ kind: "MC", ...dateRange(addDays(today, -2), today), mcCategory: "Respiratory", diagnosis: "SECRET DX", onens: "OWED" }); // ends today, owes ONENS
    await rec({ kind: "STATUS", absent: false, detail: "LIGHT DUTY", ...dateRange(today, addDays(today, 3)) }); // not ending
    await rec({ kind: "MA", detail: "MA", maTiming: "0930", location: "NSC", ...dateRange(addDays(today, 1), addDays(today, 1)) }); // tomorrow
    const rso = await rec({ kind: "RSO", state: "APPROVED", decidedAt: new Date(Date.now() - 25 * 3600 * 1000), location: "CLINIC", reason: "Fever" }); // no outcome
    await rec({ kind: "AL", state: "PENDING", absent: true, createdAt: new Date(Date.now() - 13 * 3600 * 1000), ...dateRange(addDays(today, 9), addDays(today, 9)) }); // stale

    const { eveningRound } = await import("@/lib/wb/evening");
    calls = [];
    const s = await eveningRound(out());
    expect(s).toMatchObject({ skipped: false, ending: 1, tomorrow: 1, onens: 1, chased: 1, digests: 1, heartbeats: 1 });

    const to = (id: number) => calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === id).map((c) => String(c.payload.text));
    const mine = to(TROOPER);
    expect(mine.find((t) => t.startsWith("✅ That ends today"))).toMatch(/MC 3 days · .* · Respiratory/);
    expect(mine.find((t) => t.startsWith("📅 Tomorrow"))).toMatch(/MA .* 0930H @ NSC/);
    expect(mine.find((t) => t.startsWith("☁️ Still to do: upload to ONENS"))).toBeDefined();
    expect(mine.find((t) => t.startsWith("💊 What did the doctor give you?"))).toMatch(/RSO .* @ CLINIC/);
    const onensMsg = calls.find((c) => String(c.payload.text).startsWith("☁️ Still to do"))!;
    const mcId = (await db.select().from(wbRecord).where(eq(wbRecord.kind, "MC")))[0].id;
    expect(onensMsg.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "☁️ Uploaded", callback_data: `o:${mcId}` }]] });
    const chase = calls.find((c) => String(c.payload.text).startsWith("💊"))!;
    expect(chase.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "💊 Update outcome", url: `https://t.me/sabrecoybot/app?startapp=records__${rso.id}__outcome` }]] });

    const digest = calls.find((c) => c.payload.chat_id === GROUP.id)!;
    expect(digest.payload).toMatchObject({ message_thread_id: 7 });
    expect(String(digest.payload.text)).toMatch(/^🌙 Tonight · PLATOON 6\n\n✅ 1 man back to full duty tomorrow\n• PTE IRFAN \(SLR\): MC 3 days .* Respiratory\n\n⏳ 1 request waiting more than 12 hours$/);
    expect(calls.at(-1)!.payload).toMatchObject({ chat_id: ADMIN, text: expect.stringMatching(/^💓 Still here/) });
    for (const c of calls) expect(String(c.payload.text)).not.toContain("SECRET DX");

    // once a day: a second trigger sends nothing; a forced run by hand does
    calls = [];
    expect(await eveningRound(out())).toMatchObject({ skipped: true });
    expect(calls).toEqual([]);
    expect((await eveningRound(out(), new Date(), { force: true })).skipped).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
    vi.stubEnv("WB_APP_URL", "https://sabre.example");
  });

  it("a recorded outcome stops the chase; the ONENS button marks it uploaded, for him only", async (ctx) => {
    if (!reachable) ctx.skip();
    await people();
    const rso = await rec({ kind: "RSO", state: "APPROVED", decidedAt: new Date(Date.now() - 25 * 3600 * 1000), outcomeAt: new Date() });
    const mc = await rec({ kind: "MC", parentId: rso.id, onens: "OWED", mcCategory: "Dental", ...dateRange(addDays(todaySgt(), -5), addDays(todaySgt(), -4)) });
    const { eveningRound } = await import("@/lib/wb/evening");
    const s = await eveningRound(out());
    expect(s).toMatchObject({ chased: 0, onens: 1 });

    // someone else tapping it (it's his DM, but the callback could be replayed)
    await member(84, [{ role: "GC" }]);
    expect(answerOf(await send(tap(`o:${mc.id}`, { from: 84, messageId: 5, chat: { id: 84, type: "private" } as never })))).toMatchObject({ text: "That isn't yours.", show_alert: true });
    const c = await send(tap(`o:${mc.id}`, { from: TROOPER, messageId: 5, chat: { id: TROOPER, type: "private" } as never }));
    expect(answerOf(c)).toMatchObject({ text: "Marked as uploaded" });
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, mc.id)))[0].onens).toBe("DONE");
    expect(c.find((x) => x.method === "editMessageReplyMarkup")).toBeDefined();
    const [a] = await db.select().from(wbAudit).where(eq(wbAudit.action, "onens-done"));
    expect(a.via).toBe("BOT");
  });

  it("/sick offers report sick and a standalone MC", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await send(command("/sick", { from: 70 }));
    expect(c[0].payload.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "🤒 Report sick", web_app: { url: "https://sabre.example/tg/apply/sick" } }],
        [{ text: "💊 Record an MC or status", web_app: { url: "https://sabre.example/tg/apply/outcome" } }],
      ],
    });
  });

  it("a waiting account (registered, not on the roster, no grant) is told so, with no button; a grant holder isn't", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(71);
    for (const cmd of ["/sick", "/leave", "/me"]) {
      const c = await send(command(cmd, { from: 71 }));
      expect(c[0].payload.text).toBe("You're not on the parade state yet. Your PS can see you on Roster.");
      expect(c[0].payload.reply_markup).toBeUndefined();
    }
    await member(72, [{ role: "ADMIN" }]);
    const c = await send(command("/leave", { from: 72 }));
    expect(c[0].payload.text).toBe("Which leave?");
  });
});
