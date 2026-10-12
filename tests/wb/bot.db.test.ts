// The bot driven by a fake Telegram: updates go in through handleUpdate and
// every API call is captured instead of sent. Uses sabre_test; skipped if unreachable.

import { eq } from "drizzle-orm";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { subunit } from "@/lib/db/schema";
import { wbAudit, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
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
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function member(telegramUserId: number, grants: { role: "PS" | "PC" | "ADMIN" | "GC"; subunitId?: string }[] = []) {
  const [m] = await db.insert(wbMember).values({ telegramUserId, tgName: "T", registeredAt: new Date() }).returning();
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
