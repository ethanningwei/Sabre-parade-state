// RF requests and Extra/RF/SOL through the database: raise (cards to the
// camp's platoon and COY HQ, the raiser's own copy), deploy (every copy
// edited, the man told, his platoon told with its manning), the race for the
// last slot, close (from the Mini App and the card), stand down (reopens),
// Assign, the forecast and an approval card's line moving, and the evening
// digest. Nothing reaches v1 duty or absence. Telegram is faked. Uses
// sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, camp, duty, person, subunit } from "@/lib/db/schema";
import { wbAssignment, wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbMinManning, wbRecord, wbRfCard, wbRfRequest } from "@/lib/wb/db/schema";
import { addDays, dayRange, todaySgt } from "@/lib/wb/domain/timeline";
import { createBot } from "@/lib/wb/telegram/bot";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const tg = vi.hoisted(() => ({ calls: [] as { method: string; payload: Record<string, unknown> }[], next: 100 }));
vi.mock("@/lib/wb/telegram/outbound", async () => {
  const { Api } = await import("grammy");
  const api = new Api("123:TEST");
  api.config.use(async (_prev, method, payload) => {
    tg.calls.push({ method, payload: payload as Record<string, unknown> });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: { message_id: ++tg.next, date: 0, chat: { id: 0, type: "private" } } } as any;
  });
  return { outbound: async () => ({ api, botUsername: "sabrecoybot" }) };
});

const { signIn } = await import("@/lib/wb/auth");
const actions = await import("@/lib/wb/actions/rf");
const recordActions = await import("@/lib/wb/actions/records");
const data = await import("@/lib/wb/forecast-data");
const rfData = await import("@/lib/wb/rf-data");
const { eveningRound } = await import("@/lib/wb/evening");
const { outbound } = await import("@/lib/wb/telegram/outbound");
const { courierOf } = await import("@/lib/wb/telegram/courier");

const bot = createBot("123:TEST", { id: 1, is_bot: true, first_name: "Sabre", username: "sabrecoybot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as UserFromGetMe);
bot.api.config.use(async (_prev, method, payload) => {
  tg.calls.push({ method, payload: payload as Record<string, unknown> });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, result: true } as any;
});
let updateId = 0;
const tap = (data: string, from: number, chatId: number, messageId: number): Update =>
  ({
    update_id: ++updateId,
    callback_query: { id: `cb${updateId}`, from: { id: from, is_bot: false, first_name: "T" }, chat_instance: "ci", data, message: { message_id: messageId, date: 0, chat: { id: chatId, type: "supergroup", title: "x" }, text: "card" } },
  }) as Update;

let reachable = true;
const ids = { hq: "", pl6: "", pl7: "", slr: "", srfA: "", bdk: "", hdn: "" };
const people: Record<string, string[]> = {};

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  vi.stubEnv("WB_APP_URL", "https://sabre.example");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const sub = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  ids.hq = await sub("COY HQ");
  ids.pl6 = await sub("PLATOON 6");
  ids.pl7 = await sub("PLATOON 7");
  ids.slr = await campId("SLR");
  ids.srfA = await campId("SRF A");
  ids.bdk = await campId("BDK");
  ids.hdn = await campId("HDN");
  for (const [name, id] of Object.entries({ SLR: ids.slr, BDK: ids.bdk, HDN: ids.hdn })) {
    const rows = await db.select({ id: person.id }).from(person).where(and(eq(person.campId, id), eq(person.active, true))).orderBy(person.sortOrder);
    people[name] = rows.map((r) => r.id);
  }
  // BDK: one GC, the rest ST CBT, so a request for ST CBT has candidates there
  for (const [i, id] of people.BDK.entries()) await db.update(person).set({ role: i === 0 ? "GC" : "CBT" }).where(eq(person.id, id));
});
async function clean() {
  await db.delete(wbRfCard);
  await db.delete(wbAssignment);
  await db.delete(wbRfRequest);
  await db.delete(wbConversation);
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbMinManning);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  tg.calls = [];
  await clean();
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

type Role = "PS" | "PC" | "GC" | "OC" | "ASA" | "ADMIN";
async function member(tgId: number, personId: string | null, grants: { role: Role; subunitId?: string; campId?: string }[] = []) {
  const [m] = await db.insert(wbMember).values({ telegramUserId: tgId, tgName: `T${tgId}`, personId, registeredAt: new Date(), leaveLeft: 14, source: personId ? "ROSTER" : "SELF" }).returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: g.role, subunitId: g.subunitId ?? null, campId: g.campId ?? null });
  return m;
}
async function as(tgId: number) {
  jar.clear();
  await signIn({ id: tgId, first_name: `T${tgId}` });
}
const sends = () => tg.calls.filter((c) => c.method === "sendMessage");
const edits = () => tg.calls.filter((c) => c.method === "editMessageText");
const day = (n: number) => addDays(todaySgt(), n);
const v1Rows = async () => ({ duties: (await db.select({ id: duty.id }).from(duty)).length, absences: (await db.select({ id: absence.id }).from(absence)).length });

const GC_SLR = 3001;
const PS7 = 2007;
const PS6 = 2006;
const OC = 4001;
const MAN = 1001; // a BDK man with an account
const CHAT6 = -1006;
const CHAT7 = -1007;
const CHAT_HQ = -1000;

async function setup() {
  await member(GC_SLR, people.SLR[0], [{ role: "GC", campId: ids.slr }]);
  await member(PS7, null, [{ role: "PS", subunitId: ids.pl7 }]);
  await member(PS6, null, [{ role: "PS", subunitId: ids.pl6 }]);
  await member(OC, null, [{ role: "OC" }]);
  await member(MAN, people.BDK[1]);
  await db.insert(wbCommanderChat).values([
    { subunitId: ids.pl6, chatId: CHAT6, threadId: 66, chatTitle: "PL6" },
    { subunitId: ids.pl7, chatId: CHAT7, threadId: null, chatTitle: "PL7" },
    { subunitId: ids.hq, chatId: CHAT_HQ, threadId: null, chatTitle: "HQ" },
  ]);
  tg.calls = [];
}
const raise = (over: Record<string, unknown> = {}) =>
  actions.raiseRequest({ campId: ids.slr, role: "ST CBT", need: 2, startDate: day(1), startTime: "2100", endDate: day(2), endTime: "0900", reason: "two on mc", ...over });

describe("raising an RF (DB)", () => {
  it("posts the card to the camp's platoon and COY HQ, and gives the raiser his own copy with Close", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    const res = await raise();
    expect(res).toMatchObject({ ok: true, data: { delivery: "sent", chats: 2 } });
    const id = (res as { data: { requestId: string } }).data.requestId;
    const posted = sends();
    expect(posted.map((c) => [c.payload.chat_id, c.payload.message_thread_id])).toEqual([
      [CHAT6, 66],
      [CHAT_HQ, undefined],
      [GC_SLR, undefined],
    ]);
    expect(String(posted[0].payload.text)).toMatch(/^🚌 RF REQUEST\n\nCamp: SLR · PLATOON 6\nDuration: .+ 2100–.+ 0900\nManpower required: 2x ST CBT\nReason: TWO ON MC\n\n⏳ Still short 2 of 2\nraised by /);
    const buttons = (c: (typeof posted)[number]) => (c.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
    expect(buttons(posted[0])).toEqual(["📌 Deploy someone", "❌ Close", "Open"]);
    expect(buttons(posted[2])).toEqual(["❌ Close", "Open"]);
    const cards = await db.select().from(wbRfCard).where(eq(wbRfCard.rfRequestId, id));
    expect(cards.map((c) => [c.chatId, c.own])).toEqual([
      [CHAT6, false],
      [CHAT_HQ, false],
      [GC_SLR, true],
    ]);
    expect((await db.select({ a: wbAudit.action }).from(wbAudit)).map((x) => x.a)).toEqual(["raise-rf"]);
  });

  it("refuses a GC for another camp, a past range, and nobody's watching when no chat is linked", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(GC_SLR, people.SLR[0], [{ role: "GC", campId: ids.slr }]);
    await as(GC_SLR);
    expect(await raise({ campId: ids.srfA })).toEqual({ ok: false, error: "You can't ask for manpower for SRF A." });
    expect(await raise({ startDate: day(-1) })).toMatchObject({ ok: false, error: expect.stringMatching(/in the past/) });
    expect(await raise({ need: 0 })).toMatchObject({ ok: false });
    expect(await raise()).toMatchObject({ ok: true, data: { delivery: "no-chat", chats: 0 } });
  });
});

describe("deploying (DB)", () => {
  async function raised(need = 2) {
    await setup();
    await as(GC_SLR);
    const res = (await raise({ need })) as { ok: true; data: { requestId: string } };
    tg.calls = [];
    return res.data.requestId;
  }

  it("sends the man: an assignment, every copy edited, he's told, his platoon is told with its manning", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await raised();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length });
    const before = await v1Rows();
    await as(PS7);
    expect(await actions.deployMan(id, people.BDK[1])).toEqual({ ok: true, data: { state: "OPEN", away: [] } });

    const [a] = await db.select().from(wbAssignment);
    expect(a).toMatchObject({ personId: people.BDK[1], type: "RF", campId: ids.slr, rfRequestId: id, state: "ACTIVE" });
    expect(edits()).toHaveLength(3);
    for (const e of edits()) expect(String(e.payload.text)).toMatch(/Manpower deployed: \S+ .+ \(BDK\)\n\n⏳ Still short 1 of 2/);
    const toMan = sends().find((c) => c.payload.chat_id === MAN)!;
    expect(String(toMan.payload.text)).toMatch(/^🚌 You've been sent on RF\n\nRF @ SLR .+\nAbsent from BDK, counted at SLR\.\n\nSent by T2007\. Report to SLR\.$/);
    const toPl7 = sends().find((c) => c.payload.chat_id === CHAT7)!;
    expect(String(toPl7.payload.text)).toMatch(/^🚌 Sent on RF by T2007\n\n.+ \(BDK\)\nRF @ SLR .+\n\n⚠️ BDK on .+ without|^🚌 Sent on RF by T2007\n\n.+ \(BDK\)\nRF @ SLR [^]+\n\n⚠️ BDK on \d\d\/\d\d \(worst day\): 17 \/ min 18 — BELOW MINIMUM$/);
    // the raiser hears his camp is getting someone
    expect(String(sends().find((c) => c.payload.chat_id === GC_SLR)!.payload.text)).toMatch(/^✅ SLR is getting .+ \(BDK\)\n\n⏳ Still short 1 of 2$/);
    // nothing reached the parade state
    expect(await v1Rows()).toEqual(before);
  });

  it("fills on the last man: FILLED everywhere, buttons down to Open", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await raised(1);
    await as(PS7);
    expect(await actions.deployMan(id, people.BDK[1])).toMatchObject({ ok: true, data: { state: "FILLED" } });
    expect((await db.select({ s: wbRfRequest.state }).from(wbRfRequest))[0].s).toBe("FILLED");
    for (const e of edits()) {
      expect(String(e.payload.text)).toContain("✅ FILLED");
      expect((e.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text)).toEqual(["Open"]);
    }
    expect(await actions.deployMan(id, people.BDK[2])).toEqual({ ok: false, error: "Somebody got there first: that request is already filled." });
  });

  it("the race for the last slot: exactly one of two commanders wins", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await raised(1);
    const { deploy } = await import("@/lib/wb/rf");
    const out = courierOf(await outbound());
    const actor = async (tgId: number) => {
      const [m] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, tgId));
      const grants = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, m.id));
      return { id: m.id, personId: m.personId, grants };
    };
    const results = await Promise.all([deploy(out, await actor(PS7), id, people.BDK[1], "MINIAPP"), deploy(out, await actor(OC), id, people.HDN[0], "BOT")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "Somebody got there first: that request is already filled." });
    expect(await db.select().from(wbAssignment)).toHaveLength(1);
    expect((await db.select({ s: wbRfRequest.state }).from(wbRfRequest))[0].s).toBe("FILLED");
  });

  it("refuses the camp's own man, a man outside his scope, and a man already sent somewhere then; warns on leave", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await raised();
    await as(GC_SLR);
    expect(await actions.deployMan(id, people.SLR[1])).toMatchObject({ ok: false, error: expect.stringMatching(/is SLR's own\. RF is served at another camp\./) });
    expect(await actions.deployMan(id, people.BDK[1])).toMatchObject({ ok: false, error: expect.stringMatching(/he isn't in your platoon or camp/) });
    await as(OC);
    // already on Extra at HDN over the same night
    expect(await actions.assignMen({ type: "EXTRA", campId: ids.hdn, personIds: [people.BDK[3]], startDate: day(2), startTime: "0000", endDate: day(2), endTime: "2359" })).toMatchObject({ ok: true });
    expect(await actions.deployMan(id, people.BDK[3])).toMatchObject({ ok: false, error: expect.stringMatching(/is already on Extra @ HDN/) });
    // on leave: a warning, not a veto
    await db.insert(wbRecord).values({ personId: people.BDK[4], kind: "AL", startAt: dayRange(day(1)).startAt, endAt: dayRange(day(3)).startAt, absent: true, state: "APPROVED", createdVia: "SELF" });
    expect(await actions.deployMan(id, people.BDK[4])).toMatchObject({ ok: true, data: { away: [expect.stringMatching(/^AL .+ · approved$/)] } });
  });

  it("the deploy list: everyone he may send, best first, with what losing each does to his camp", async (ctx) => {
    if (!reachable) ctx.skip();
    const id = await raised();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length });
    const r = (await rfData.rfView(id))!;
    const [ps7] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, PS7));
    const grants = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, ps7.id));
    const list = await rfData.candidatesFor(r, grants);
    expect(new Set(list.map((c) => c.subunitId))).toEqual(new Set([ids.pl7]));
    const first = list[0];
    expect(first).toMatchObject({ role: "ST CBT", refusal: null });
    expect(list.filter((c) => c.campId === ids.bdk).every((c) => /^BDK on .+ without him: 17 \/ min 18 — BELOW MINIMUM$/.test(c.manning ?? ""))).toBe(true);
  });
});

describe("deploying, through the Courier's seam (DB)", () => {
  it("tells the man, his platoon and the raiser, and redraws the request's cards: no Telegram fake needed", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    const id = ((await raise()) as { ok: true; data: { requestId: string } }).data.requestId;
    const { deploy } = await import("@/lib/wb/rf");
    const { recordingCourier } = await import("./recording-courier");
    const [ps7] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, PS7));
    const courier = recordingCourier();
    const res = await deploy(courier, { id: ps7.id, personId: null, grants: [{ role: "PS", subunitId: ids.pl7, campId: null }] }, id, people.BDK[1], "MINIAPP");
    expect(res.ok).toBe(true);
    expect(courier.sent.map((s) => ("send" in s ? { send: s.send } : s))).toEqual([
      { redraw: { rf: id } },
      { send: { person: people.BDK[1] } },
      { send: { platoon: ids.pl7 } },
      { send: { telegramId: GC_SLR } },
    ]);
  });
});

describe("closing and standing down (DB)", () => {
  it("the raiser closes from the Mini App; a second close and another platoon are refused; men sent stay sent", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    const { data } = (await raise()) as { ok: true; data: { requestId: string } };
    await as(PS7);
    await actions.deployMan(data.requestId, people.BDK[1]);
    expect(await actions.closeRequest(data.requestId)).toEqual({ ok: false, error: "Only whoever asked, or SLR's commanders, can close this." });
    await as(GC_SLR);
    tg.calls = [];
    expect(await actions.closeRequest(data.requestId)).toEqual({ ok: true, data: { stillSent: 1 } });
    for (const e of edits()) expect(String(e.payload.text)).toMatch(/❌ CLOSED — no longer needed \(.+\)/);
    expect(await actions.closeRequest(data.requestId)).toEqual({ ok: false, error: "It's already closed." });
    expect(await db.select({ s: wbAssignment.state }).from(wbAssignment)).toEqual([{ s: "ACTIVE" }]);
  });

  it("Close on the card works for the camp's commanders and alerts anyone else", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    const { data } = (await raise()) as { ok: true; data: { requestId: string } };
    tg.calls = [];
    await bot.handleUpdate(tap(`f:${data.requestId}:x`, PS7, CHAT_HQ, 5));
    expect(tg.calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({ text: "Only whoever asked, or SLR's commanders, can close this.", show_alert: true });
    tg.calls = [];
    await bot.handleUpdate(tap(`f:${data.requestId}:x`, PS6, CHAT6, 5));
    expect(tg.calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({ text: "Closed" });
    expect(tg.calls.filter((c) => c.method === "editMessageText")).toHaveLength(3);
    expect((await db.select({ s: wbRfRequest.state }).from(wbRfRequest))[0].s).toBe("CLOSED");
  });

  it("standing a man down reopens a filled request and tells him and his platoon", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    const { data } = (await raise({ need: 1 })) as { ok: true; data: { requestId: string } };
    await as(PS7);
    await actions.deployMan(data.requestId, people.BDK[1]);
    const [a] = await db.select().from(wbAssignment);
    tg.calls = [];
    await as(PS6);
    // the camp that asked may release him too
    expect(await actions.standDownMan(a.id)).toEqual({ ok: true, data: undefined });
    expect((await db.select({ s: wbRfRequest.state }).from(wbRfRequest))[0].s).toBe("OPEN");
    expect(await db.select({ s: wbAssignment.state }).from(wbAssignment)).toEqual([{ s: "CANCELLED" }]);
    expect(String(sends().find((c) => c.payload.chat_id === MAN)!.payload.text)).toMatch(/^↩️ Stood down\n\nRF @ SLR /);
    expect(String(sends().find((c) => c.payload.chat_id === CHAT7)!.payload.text)).toMatch(/^↩️ Stood down by T2006\n\n.+ \(BDK\)\nRF @ SLR .+\n\nBack with BDK\.$/);
    for (const e of edits()) expect(String(e.payload.text)).toContain("⏳ Still short 1 of 1");
    expect(await actions.standDownMan(a.id)).toEqual({ ok: false, error: "He's already been stood down." });
  });
});

describe("assign (DB)", () => {
  it("Extra and SOL straight onto men: each told, one message per platoon, refusals named", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(PS7);
    expect(await actions.assignMen({ type: "EXTRA", campId: ids.bdk, personIds: [people.BDK[1]], startDate: day(1), startTime: "0000", endDate: day(1), endTime: "2359" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Extra can't be served at his own team \(BDK\)/),
    });
    expect(await actions.assignMen({ type: "SOL", campId: null, personIds: [people.SLR[1]], startDate: day(1), startTime: "0000", endDate: day(5), endTime: "2359" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/he isn't in your platoon or camp/),
    });
    expect(await actions.assignMen({ type: "SOL", campId: ids.slr, personIds: [people.BDK[1], people.BDK[2]], startDate: day(1), startTime: "0000", endDate: day(5), endTime: "2359" })).toEqual({ ok: true, data: { count: 2 } });
    // SOL stands with his own camp, whatever camp was passed
    expect((await db.select({ c: wbAssignment.campId }).from(wbAssignment)).every((x) => x.c === ids.bdk)).toBe(true);
    expect(String(sends().find((c) => c.payload.chat_id === MAN)!.payload.text)).toMatch(/^⛔ You're on SOL\n\nSOL /);
    const pl7 = sends().filter((c) => c.payload.chat_id === CHAT7);
    expect(pl7).toHaveLength(1);
    expect(String(pl7[0].payload.text)).toMatch(/^📌 SOL .+\nby T2007\n\n• .+ \(BDK\)\n• .+ \(BDK\)\n\nLeave stopped\. They stand with their own camp\.$/);
    // the same men again over the same days
    expect(await actions.assignMen({ type: "EXTRA", campId: ids.hdn, personIds: [people.BDK[2]], startDate: day(3), startTime: "0000", endDate: day(3), endTime: "2359" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/is already on SOL @ BDK/),
    });
    // his leave application now shows the SOL in the clash check
    await as(MAN);
    expect(await recordActions.checkClash({ startDate: day(2), startTime: "0000", endDate: day(2), endTime: "2359" })).toMatchObject({ ok: true, data: [expect.stringMatching(/^SOL @ BDK /)] });
  });
});

describe("assignments in the forecast and on cards (DB)", () => {
  it("an RF man counts at the camp that asked and is away from his own; an Off card in his platoon sees it", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length - 1 });
    await as(GC_SLR);
    const { data: req } = (await raise({ startDate: day(1), startTime: "0000", endDate: day(1), endTime: "2359", need: 1 })) as { ok: true; data: { requestId: string } };
    const before = await data.grid([ids.slr, ids.bdk], day(1), 1);
    await as(PS7);
    await actions.deployMan(req.requestId, people.BDK[1]);
    const after = await data.grid([ids.slr, ids.bdk], day(1), 1);
    const heads = (rows: typeof before, campId: string) => Number(rows.find((r) => r.campId === campId)!.cells[0].label);
    expect(heads(after, ids.slr)).toBe(heads(before, ids.slr) + 1);
    expect(heads(after, ids.bdk)).toBe(heads(before, ids.bdk) - 1);
    const dayView = await data.dayView([ids.bdk], day(1));
    expect(dayView[0].away).toEqual([expect.objectContaining({ personId: people.BDK[1], what: "OTHERS: RF @ SLR", assignmentId: expect.any(String) })]);

    // another BDK man asks for Off that day: his card's line counts the RF man out too
    await member(1002, people.BDK[2]);
    await as(1002);
    tg.calls = [];
    expect(await recordActions.applyOff({ startDate: day(1), startTime: "0000", endDate: day(1), endTime: "2359" })).toMatchObject({ ok: true });
    const card = sends().find((c) => c.payload.chat_id === CHAT7)!;
    expect(String(card.payload.text)).toContain(`⚠️ BDK on ${day(1).slice(8, 10)}/${day(1).slice(5, 7)}: ${people.BDK.length - 2} / min ${people.BDK.length - 1} — BELOW MINIMUM`);
  });

  it("the evening digest lists open requests for the camp's platoon and COY HQ", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(GC_SLR);
    await raise();
    tg.calls = [];
    const summary = await eveningRound(courierOf(await outbound()), new Date(), { force: true });
    expect(summary.rf).toBe(1);
    const digest = (chat: number) => String(sends().find((c) => c.payload.chat_id === chat && String(c.payload.text).startsWith("🌙"))?.payload.text ?? "");
    expect(digest(CHAT6)).toMatch(/🚌 1 RF request still open\n• SLR .+: short 2 of 2/);
    expect(digest(CHAT_HQ)).toMatch(/🚌 1 RF request still open, company-wide\n• SLR .+: short 2 of 2 \(PLATOON 6\)/);
    expect(digest(CHAT7)).toBe("");
  });
});
