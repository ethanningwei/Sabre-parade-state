// The Courier through the database, over a fake Telegram: where each card
// goes (no chat, a topic, offline), remembering and redrawing every copy, an
// outcome's card with Replaces, an RF request's platoon + COY HQ copies (each
// chat once) and the raiser's own, and plain sends to a platoon, a man, an id
// and the admins. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { Api } from "grammy";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbCard, wbCommanderChat, wbGrant, wbMember, wbRecord, wbRfCard, wbRfRequest } from "@/lib/wb/db/schema";
import { addDays, dayRange, todaySgt } from "@/lib/wb/domain/timeline";
import { courierOf, type Courier } from "@/lib/wb/telegram/courier";
import { exampleSnapshot } from "../fixtures/example-snapshot";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const tg = { calls: [] as { method: string; payload: Record<string, unknown> }[], next: 100, fail: null as null | { method: string; description: string } };
const api = new Api("123:TEST");
api.config.use(async (_prev, method, payload) => {
  tg.calls.push({ method, payload: payload as Record<string, unknown> });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (tg.fail?.method === method) return { ok: false, error_code: 400, description: tg.fail.description } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, result: { message_id: ++tg.next, date: 0, chat: { id: 0, type: "private" } } } as any;
});
const online: Courier = courierOf({ api, botUsername: "sabrecoybot" });
const offline: Courier = courierOf(null);

let reachable = true;
const ids = { hq: "", pl6: "", slr: "", man: "", other: "" };
const CHAT6 = -1006;
const CHAT_HQ = -1000;
const MAN_TG = 1001;

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const sub = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
  ids.hq = await sub("COY HQ");
  ids.pl6 = await sub("PLATOON 6");
  ids.slr = (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR")))[0].id;
  const men = await db.select({ id: person.id }).from(person).where(and(eq(person.campId, ids.slr), eq(person.active, true))).orderBy(person.sortOrder);
  ids.man = men[0].id;
  ids.other = men[1].id;
});
async function clean() {
  await db.delete(wbRfCard);
  await db.delete(wbRfRequest);
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
beforeEach(async () => {
  if (!reachable) return;
  tg.calls = [];
  tg.fail = null;
  vi.unstubAllEnvs();
  await clean();
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

const link = (subunitId: string, chatId: number, threadId: number | null) => db.insert(wbCommanderChat).values({ subunitId, chatId, threadId, chatTitle: String(chatId) });
const sends = () => tg.calls.filter((c) => c.method === "sendMessage");
const edits = () => tg.calls.filter((c) => c.method === "editMessageText");
const buttons = (c: { payload: Record<string, unknown> }) => (c.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);

async function offRecord() {
  const r = dayRange(addDays(todaySgt(), 3));
  const [row] = await db
    .insert(wbRecord)
    .values({ personId: ids.man, kind: "OFF", startAt: r.startAt, endAt: r.endAt, absent: true, state: "PENDING", createdVia: "SELF" })
    .returning({ id: wbRecord.id });
  return row.id;
}

describe("a record's card (DB)", () => {
  it("no commanders chat: no-chat, online or not, and nothing is sent", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await offRecord();
    expect(await online.postCard({ record: id })).toEqual({ delivery: "no-chat", chats: 0 });
    expect(await offline.postCard({ record: id })).toEqual({ delivery: "no-chat", chats: 0 });
    expect(tg.calls).toEqual([]);
  });

  it("posts into the platoon's topic, remembers it, and redraws it; offline it fails and redraws nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await link(ids.pl6, CHAT6, 66);
    const id = await offRecord();
    expect(await offline.postCard({ record: id })).toEqual({ delivery: "failed", chats: 1 });
    expect(tg.calls).toEqual([]);

    expect(await online.postCard({ record: id })).toEqual({ delivery: "sent", chats: 1 });
    expect(sends().map((c) => [c.payload.chat_id, c.payload.message_thread_id])).toEqual([[CHAT6, 66]]);
    expect(buttons(sends()[0])).toEqual(["✅ Approve", "❌ Reject", "Open"]);
    const posted = tg.next;
    const [card] = await db.select().from(wbCard);
    expect(card).toMatchObject({ recordId: id, chatId: CHAT6, threadId: 66, messageId: posted });

    await db.update(wbRecord).set({ state: "APPROVED", decidedAt: new Date() }).where(eq(wbRecord.id, id));
    await online.redraw({ record: id });
    expect(edits().map((c) => [c.payload.chat_id, c.payload.message_id])).toEqual([[CHAT6, posted]]);
    expect(buttons(edits()[0])).toEqual(["↩ Undo", "Open"]);

    tg.calls = [];
    await offline.redraw({ record: id });
    expect(tg.calls).toEqual([]);
  });

  it("a PC's own pending request goes to COY HQ's chat too, for OC/2IC/CSM, and both copies are remembered", async (ctx) => {
    if (!reachable) ctx.skip();
    await link(ids.pl6, CHAT6, 66);
    await link(ids.hq, CHAT_HQ, null);
    const [pc] = await db.insert(wbMember).values({ telegramUserId: 3001, tgName: "PC", personId: ids.man, registeredAt: new Date(), source: "ROSTER" }).returning();
    await db.insert(wbGrant).values({ memberId: pc.id, role: "PC", subunitId: ids.pl6 });
    const id = await offRecord();
    expect(await online.postCard({ record: id })).toEqual({ delivery: "sent", chats: 2 });
    expect(sends().map((c) => c.payload.chat_id)).toEqual([CHAT6, CHAT_HQ]);
    expect(await db.select().from(wbCard).where(eq(wbCard.recordId, id))).toHaveLength(2);
  });

  it("a redraw Telegram calls unchanged is quiet; a failed post is failed, not thrown", async (ctx) => {
    if (!reachable) ctx.skip();
    await link(ids.pl6, CHAT6, null);
    const id = await offRecord();
    await online.postCard({ record: id });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    tg.fail = { method: "editMessageText", description: "Bad Request: message is not modified" };
    await expect(online.redraw({ record: id })).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    tg.fail = { method: "sendMessage", description: "Forbidden: bot was kicked" };
    expect(await online.postCard({ record: id })).toEqual({ delivery: "failed", chats: 1 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("an outcome's card: the whole batch, MC first, Replaces, remembered on the head", async (ctx) => {
    if (!reachable) ctx.skip();
    await link(ids.pl6, CHAT6, 66);
    const r = dayRange(todaySgt());
    const at = new Date();
    const rows = await db
      .insert(wbRecord)
      .values([
        { personId: ids.man, kind: "STATUS", detail: "LIGHT DUTY", startAt: r.startAt, endAt: r.endAt, absent: false, state: "RECORDED", createdVia: "SELF", createdAt: at },
        { personId: ids.man, kind: "MC", mcCategory: "Respiratory", diagnosis: "SECRET", startAt: r.startAt, endAt: r.endAt, absent: true, state: "RECORDED", createdVia: "SELF", createdAt: at },
      ])
      .returning({ id: wbRecord.id, kind: wbRecord.kind });
    const statusId = rows.find((x) => x.kind === "STATUS")!.id;
    const mcId = rows.find((x) => x.kind === "MC")!.id;
    expect(await online.postCard({ record: statusId }, { replaces: ["MC 2 days"] })).toEqual({ delivery: "sent", chats: 1 });
    const text = String(sends()[0].payload.text);
    expect(text).toMatch(/^✏️ Outcome corrected\n/);
    expect(text).toMatch(/Replaces\nMC 2 days/);
    expect(text.indexOf("MC")).toBeLessThan(text.indexOf("LIGHT DUTY"));
    expect(text).not.toContain("SECRET");
    expect((await db.select().from(wbCard))[0].recordId).toBe(mcId);
    // a redraw from any row of the batch finds the card
    await online.redraw({ record: statusId });
    expect(edits()).toHaveLength(1);
  });
});

describe("an RF request's card (DB)", () => {
  async function request(raisedByTg: number | null) {
    const raiser = raisedByTg ? (await db.insert(wbMember).values({ telegramUserId: raisedByTg, tgName: "GC", personId: ids.other, registeredAt: new Date(), source: "ROSTER" }).returning())[0] : null;
    const r = dayRange(addDays(todaySgt(), 1));
    const [row] = await db
      .insert(wbRfRequest)
      .values({ campId: ids.slr, role: "ST CBT", need: 2, startAt: r.startAt, endAt: r.endAt!, reason: "TWO ON MC", raisedBy: raiser?.id ?? null })
      .returning({ id: wbRfRequest.id });
    return row.id;
  }

  it("goes to the camp's platoon first, then COY HQ, each chat once, and the raiser's own copy with Close", async (ctx) => {
    if (!reachable) ctx.skip();
    await link(ids.hq, CHAT_HQ, null);
    await link(ids.pl6, CHAT6, 66);
    const id = await request(3001);
    expect(await online.postCard({ rf: id })).toEqual({ delivery: "sent", chats: 2 });
    expect(sends().map((c) => [c.payload.chat_id, c.payload.message_thread_id])).toEqual([
      [CHAT6, 66],
      [CHAT_HQ, undefined],
      [3001, undefined],
    ]);
    expect(buttons(sends()[0])).toEqual(["📌 Deploy someone", "❌ Close", "Open"]);
    expect(buttons(sends()[2])).toEqual(["❌ Close", "Open"]);
    expect((await db.select().from(wbRfCard)).map((c) => [c.chatId, c.own])).toEqual([
      [CHAT6, false],
      [CHAT_HQ, false],
      [3001, true],
    ]);

    await db.update(wbRfRequest).set({ state: "CLOSED" }).where(eq(wbRfRequest.id, id));
    await online.redraw({ rf: id });
    expect(edits()).toHaveLength(3);
    for (const e of edits()) expect(buttons(e)).toEqual(["Open"]);
  });

  it("one chat that is both the platoon's and COY HQ's gets one copy; no chats is no-chat, offline is failed", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await request(null);
    expect(await online.postCard({ rf: id })).toEqual({ delivery: "no-chat", chats: 0 });
    await link(ids.pl6, CHAT6, 66);
    await link(ids.hq, CHAT6, 66);
    expect(await offline.postCard({ rf: id })).toEqual({ delivery: "failed", chats: 1 });
    expect(tg.calls).toEqual([]);
    expect(await online.postCard({ rf: id })).toEqual({ delivery: "sent", chats: 1 });
    expect(sends()).toHaveLength(1);
  });
});

describe("plain sends (DB)", () => {
  it("a platoon, a man, an id, the admins; buttons become links or callbacks; failures count as 0", async (ctx) => {
    if (!reachable) ctx.skip();
    expect(await online.send({ platoon: ids.pl6 }, "nobody linked")).toBe(0);
    await link(ids.pl6, CHAT6, 66);
    expect(await online.send({ platoon: ids.pl6 }, "hello", [[{ text: "Open", route: "rf" }], [{ text: "Tap", data: "o:x" }]])).toBe(1);
    expect(sends()[0].payload).toMatchObject({
      chat_id: CHAT6,
      message_thread_id: 66,
      reply_markup: { inline_keyboard: [[{ text: "Open", url: expect.stringContaining("sabrecoybot") }], [{ text: "Tap", callback_data: "o:x" }]] },
    });

    expect(await online.send({ person: ids.man }, "no account")).toBe(0);
    await db.insert(wbMember).values({ telegramUserId: MAN_TG, tgName: "M", personId: ids.man, registeredAt: new Date(), source: "ROSTER" });
    expect(await online.send({ person: ids.man }, "hi")).toBe(1);
    expect(sends().at(-1)!.payload).toEqual({ chat_id: MAN_TG, text: "hi" });
    expect(await online.send({ telegramId: null }, "nobody")).toBe(0);
    expect(await offline.send({ telegramId: MAN_TG }, "offline")).toBe(0);

    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "11, 12");
    expect(await online.send({ admins: true }, "💓")).toBe(2);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    tg.fail = { method: "sendMessage", description: "Forbidden: bot was blocked by the user" };
    expect(await online.send({ telegramId: MAN_TG }, "blocked")).toBe(0);
    expect(await online.send({ platoon: ids.pl6 }, "kicked")).toBe(0);
    error.mockRestore();
  });
});
