// The timeline through the database: apply, cards, decisions, undo, void,
// withdraw and proxy events, with Telegram faked. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, duty, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { addDays, todaySgt } from "@/lib/wb/domain/timeline";
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

// A fake Telegram behind the outbound module: every call is captured.
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
const actions = await import("@/lib/wb/actions/records");
const core = await import("@/lib/wb/decide");

let reachable = true;
let pl6: string;
let irfan: string; // PTE IRFAN, SLR, PLATOON 6: the trooper
let chunHei: string; // LCP CHUN HEI, SLR, PLATOON 6: the PS
const pl6People: string[] = [];
let pl5Person: string;

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
  const byName = async (name: string) => (await db.select({ id: person.id }).from(person).where(eq(person.name, name)))[0].id;
  irfan = await byName("IRFAN");
  chunHei = await byName("CHUN HEI");
  pl6People.push(await byName("WEI HAO"), await byName("JOSHUA LAU"), await byName("XIAO HENG"));
  pl5Person = await byName("PARTHIV");
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  tg.calls = [];
  await db.delete(wbConversation);
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
  await db.delete(duty).where(eq(duty.name, "IRFAN"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

type Role = "PS" | "PC" | "GC" | "OC" | "ASA";
async function member(tgId: number, personId: string | null, grants: { role: Role; subunitId?: string; campId?: string }[] = [], leaveLeft = 14) {
  const [m] = await db.insert(wbMember).values({ telegramUserId: tgId, tgName: `T${tgId}`, personId, registeredAt: new Date(), leaveLeft, source: personId ? "ROSTER" : "SELF" }).returning();
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, role: g.role, subunitId: g.subunitId ?? null, campId: g.campId ?? null });
  return m;
}
/** Act as this Telegram user in the Mini App. */
async function as(tgId: number) {
  jar.clear();
  await signIn({ id: tgId, first_name: `T${tgId}` });
}
const actorOf = async (tgId: number) => {
  const [m] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, tgId));
  const grants = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, m.id));
  return { id: m.id, personId: m.personId, grants };
};
const out = async () => (await import("@/lib/wb/telegram/outbound")).outbound();
const leaveOf = async (tgId: number) => (await db.select({ l: wbMember.leaveLeft }).from(wbMember).where(eq(wbMember.telegramUserId, tgId)))[0].l;
const day = (n: number) => addDays(todaySgt(), n);
const sends = () => tg.calls.filter((c) => c.method === "sendMessage");
const edits = () => tg.calls.filter((c) => c.method === "editMessageText");

const TROOPER = 1001;
const PS = 2001;

async function setup({ chat = true } = {}) {
  await member(TROOPER, irfan);
  await member(PS, chunHei, [{ role: "PS", subunitId: pl6 }]);
  if (chat) await db.insert(wbCommanderChat).values({ subunitId: pl6, chatId: -1006, threadId: 66, chatTitle: "PL6 Commanders" });
}

const al = (over: Record<string, unknown> = {}) => ({
  kind: "AL" as const,
  startDate: day(10),
  startTime: "2100",
  endDate: day(12),
  endTime: "2359",
  days: [day(10), day(11), day(12)],
  place: "JOHOR BAHRU",
  reason: "Holiday" as const,
  ...over,
});

async function applyAl(over: Record<string, unknown> = {}) {
  await as(TROOPER);
  const res = await actions.applyLeave(al(over));
  if (!res.ok) throw new Error(res.error);
  return res.data.recordId;
}

describe("timeline (DB)", () => {
  it("AL: saved PENDING, card in the platoon's topic, approve spends, undo refunds", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();

    const [rec] = await db.select().from(wbRecord).where(eq(wbRecord.id, id));
    expect(rec).toMatchObject({ kind: "AL", state: "PENDING", leaveDays: 3, detail: "AL @ JOHOR BAHRU", location: "JOHOR BAHRU", reason: "Holiday", createdVia: "SELF", absent: true });
    const [card] = sends();
    expect(card.payload).toMatchObject({ chat_id: -1006, message_thread_id: 66 });
    expect(String(card.payload.text)).toContain("⏳ Approval needed\n\nAnnual leave · PTE IRFAN\nSLR · PLATOON 6");
    expect(String(card.payload.text)).toContain("3 days of leave · 14 left, 11 after this\n@ JOHOR BAHRU · Holiday");
    expect(card.payload.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `d:${id}:a` },
          { text: "❌ Reject", callback_data: `d:${id}:r` },
        ],
        [{ text: "Open", url: `https://t.me/sabrecoybot/app?startapp=records__${id}` }],
      ],
    });
    expect(await db.select().from(wbCard)).toMatchObject([{ recordId: id, chatId: -1006, threadId: 66, messageId: tg.next }]);

    tg.calls = [];
    await as(PS);
    expect(await actions.decideRecord({ recordId: id, action: "approve" })).toEqual({ ok: true, data: { state: "APPROVED" } });
    expect(await leaveOf(TROOPER)).toBe(11);
    expect(edits()).toHaveLength(1);
    expect(String(edits()[0].payload.text)).toMatch(/✅ Approved by LCP CHUN HEI$/);
    expect(sends()).toMatchObject([{ payload: { chat_id: TROOPER, text: expect.stringContaining("✅ Approved by LCP CHUN HEI") } }]);
    expect(String(sends()[0].payload.text)).toContain("3 days of leave · 11 left");

    tg.calls = [];
    expect(await actions.undoDecision({ recordId: id })).toEqual({ ok: true, data: { state: "PENDING" } });
    expect(await leaveOf(TROOPER)).toBe(14);
    expect(String(edits()[0].payload.text)).toMatch(/^⏳ Approval needed/);
    expect(String(sends()[0].payload.text)).toMatch(/^⚠️ LCP CHUN HEI took that decision back/);

    const audits = await db.select({ action: wbAudit.action, via: wbAudit.via }).from(wbAudit).where(eq(wbAudit.entityId, id));
    expect(audits.map((a) => a.action)).toEqual(["submit", "approve", "undo"]);
    expect(audits.every((a) => a.via === "MINIAPP")).toBe(true);
  });

  it("reject, then Say why: the note reaches the record, the card and the trooper; rejecting costs nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await as(PS);
    expect(await actions.decideRecord({ recordId: id, action: "reject" })).toMatchObject({ ok: true });
    expect(await leaveOf(TROOPER)).toBe(14);
    tg.calls = [];
    expect(await actions.giveReason({ recordId: id, note: "Camp is short that weekend" })).toMatchObject({ ok: true });
    const [rec] = await db.select().from(wbRecord).where(eq(wbRecord.id, id));
    expect(rec).toMatchObject({ state: "REJECTED", decisionNote: "Camp is short that weekend" });
    expect(String(edits()[0].payload.text)).toMatch(/❌ Rejected by LCP CHUN HEI\nWhy: Camp is short that weekend$/);
    // Say why is gone once there's a reason; Undo stays
    expect((edits()[0].payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard[0].map((b) => b.text)).toEqual(["↩ Undo"]);
    expect(String(sends()[0].payload.text)).toMatch(/^💬 Why LCP CHUN HEI said no[\s\S]*Camp is short that weekend$/);
  });

  it("two approvers racing: exactly one wins, and leave is spent once", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(2002, null, [{ role: "OC" }]);
    const id = await applyAl();
    const [a, b] = await Promise.all([
      core.decide(await out(), await actorOf(PS), id, "approve", "BOT"),
      core.decide(await out(), await actorOf(2002), id, "reject", "BOT"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser).toMatchObject({ ok: false, error: expect.stringMatching(/^Already (approved|rejected) by /) });
    const [rec] = await db.select().from(wbRecord).where(eq(wbRecord.id, id));
    expect(await leaveOf(TROOPER)).toBe(rec.state === "APPROVED" ? 11 : 14);
  });

  it("only the platoon's PC/PS or company HQ decide; a GC in the chat doesn't", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    await member(3001, null, [{ role: "GC", campId: slr.id }]);
    await member(3002, null, [{ role: "PS", subunitId: (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 5")))[0].id }]);
    const id = await applyAl();
    for (const who of [3001, 3002]) {
      await as(who);
      expect(await actions.decideRecord({ recordId: id, action: "approve" })).toEqual({ ok: false, error: "Only PLATOON 6's PC or PS can decide this." });
    }
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, id)))[0].state).toBe("PENDING");
  });

  it("undo: only the decider, only for ten minutes", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(2003, null, [{ role: "PC", subunitId: pl6 }]);
    const id = await applyAl();
    await core.decide(await out(), await actorOf(PS), id, "approve", "BOT");
    expect(await core.undo(await out(), await actorOf(2003), id, "BOT")).toMatchObject({ ok: false, error: "Only LCP CHUN HEI can take that back." });
    await db.update(wbRecord).set({ decidedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(wbRecord.id, id));
    expect(await core.undo(await out(), await actorOf(PS), id, "BOT")).toMatchObject({ ok: false, error: expect.stringMatching(/^Too late/) });
    expect(await leaveOf(TROOPER)).toBe(11);
  });

  it("approving more leave than he has left is refused and changes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await db.update(wbMember).set({ leaveLeft: 2 }).where(eq(wbMember.telegramUserId, TROOPER));
    await as(PS);
    expect(await actions.decideRecord({ recordId: id, action: "approve" })).toEqual({ ok: false, error: "PTE IRFAN has only 2 days of leave left, and this needs 3." });
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, id)))[0].state).toBe("PENDING");
  });

  it("void needs a reason, refunds approved leave, and tells the trooper", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await core.decide(await out(), await actorOf(PS), id, "approve", "BOT");
    await as(PS);
    expect(await actions.voidEntry({ recordId: id, reason: "" })).toEqual({ ok: false, error: "Say why you're voiding it." });
    tg.calls = [];
    expect(await actions.voidEntry({ recordId: id, reason: "Entered twice" })).toEqual({ ok: true, data: { state: "CANCELLED" } });
    expect(await leaveOf(TROOPER)).toBe(14);
    const [rec] = await db.select().from(wbRecord).where(eq(wbRecord.id, id));
    expect(rec).toMatchObject({ state: "CANCELLED", decisionNote: "Voided by LCP CHUN HEI: Entered twice" });
    expect(String(edits()[0].payload.text)).toMatch(/🚫 Voided by LCP CHUN HEI: Entered twice$/);
    expect(String(sends()[0].payload.text)).toMatch(/^🚫 LCP CHUN HEI voided this[\s\S]*3 days of leave back · 14 left$/);
    // a pending one can't be voided, and a void can't be undone
    expect(await actions.voidEntry({ recordId: id, reason: "again" })).toMatchObject({ ok: false });
    expect(await actions.undoDecision({ recordId: id })).toMatchObject({ ok: false });
  });

  it("withdraw: his own, and only while pending", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await as(PS);
    expect(await actions.withdrawRecord({ recordId: id })).toEqual({ ok: false, error: "That isn't yours to withdraw." });
    await as(TROOPER);
    tg.calls = [];
    expect(await actions.withdrawRecord({ recordId: id })).toEqual({ ok: true, data: { state: "WITHDRAWN" } });
    expect(String(edits()[0].payload.text)).toMatch(/↩️ Withdrawn$/);
    expect(await actions.withdrawRecord({ recordId: id })).toMatchObject({ ok: false, error: expect.stringMatching(/still waiting/) });
    await as(PS);
    expect(await actions.decideRecord({ recordId: id, action: "approve" })).toEqual({ ok: false, error: "Already withdrawn." });
  });

  it("no commanders chat: saved anyway, and he's told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup({ chat: false });
    await as(TROOPER);
    const res = await actions.applyOff({ startDate: day(3), startTime: "0000", endDate: day(3), endTime: "2359" });
    expect(res).toMatchObject({ ok: true, data: { delivery: "no-chat", subunitName: "PLATOON 6" } });
    expect(await db.select().from(wbRecord)).toMatchObject([{ kind: "OFF", state: "PENDING", leaveDays: null }]);
    expect(sends()).toEqual([]);
  });

  it("MA and events are recorded straight away, with an info card", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(TROOPER);
    expect(await actions.reportMa({ date: day(2), time: "15:30", place: "national skin centre" })).toMatchObject({ ok: true, data: { delivery: "sent" } });
    expect(await actions.reportEvent({ what: "IPPT", place: "Maju camp", startDate: day(4), endDate: day(4), timeStart: "0800", timeEnd: "1200" })).toMatchObject({ ok: true });
    const rows = await db.select().from(wbRecord).orderBy(wbRecord.startAt);
    expect(rows).toMatchObject([
      { kind: "MA", state: "RECORDED", maTiming: "1530", location: "NATIONAL SKIN CENTRE" },
      { kind: "EVENT", state: "RECORDED", detail: "IPPT @ MAJU CAMP 0800-1200H" },
    ]);
    expect(String(sends()[0].payload.text)).toMatch(/^📝 Recorded, no approval needed/);
    expect(sends()[0].payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open", url: expect.stringContaining("records__") }]] });
    // an event that ends before it starts on the same day is refused
    expect(await actions.reportEvent({ what: "X", place: "Y", startDate: day(4), endDate: day(4), timeStart: "1700", timeEnd: "0800" })).toMatchObject({ ok: false });
  });

  it("checks: past dates, over-balance, days outside the range, AL beyond JB", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(TROOPER);
    expect(await actions.applyLeave(al({ startDate: day(-1) }))).toMatchObject({ ok: false, error: expect.stringMatching(/past/) });
    expect(await actions.applyLeave(al({ days: [day(10), day(13)] }))).toMatchObject({ ok: false, error: expect.stringMatching(/aren't all in the range/) });
    expect(await actions.applyLeave(al({ place: "BANGKOK" }))).toMatchObject({ ok: false, error: expect.stringMatching(/overseas leave/) });
    await db.update(wbMember).set({ leaveLeft: 2 }).where(eq(wbMember.telegramUserId, TROOPER));
    expect(await actions.applyLeave(al())).toMatchObject({ ok: false, error: expect.stringMatching(/^That's 3 days of leave and you have 2 left/) });
    // unticking a day costs less
    expect(await actions.applyLeave(al({ days: [day(10), day(11)] }))).toMatchObject({ ok: true });
    expect(await actions.applyLeave(al({ kind: "OL", place: "", city: "bangkok", country: "thailand", days: [day(10)], reason: "OTHER", reasonOther: "Friend's wedding" }))).toMatchObject({ ok: true });
    const ol = (await db.select().from(wbRecord).where(eq(wbRecord.kind, "OL")))[0];
    expect(ol).toMatchObject({ detail: "OL @ BANGKOK, THAILAND", reason: "Friend's wedding" });
  });

  it("someone not on the roster can't apply", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(4001, null);
    await as(4001);
    expect(await actions.applyOff({ startDate: day(3), startTime: "0000", endDate: day(3), endTime: "2359" })).toEqual({
      ok: false,
      error: "Ask your PS to add you to the parade state first.",
    });
  });

  it("clash: finds his live records and open duties, ignores dead ones", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await applyAl({ startDate: day(20), endDate: day(20), days: [day(20)] }); // elsewhere
    const [bdk] = await db.select({ id: camp.id, coyId: camp.coyId }).from(camp).where(eq(camp.name, "BDK"));
    await db.insert(duty).values({ coyId: bdk.coyId, type: "RF", rank: "PTE", name: "IRFAN", personId: irfan, campId: bdk.id, startDate: day(12), endDate: day(13), sortOrder: 99 });
    await as(TROOPER);
    const res = await actions.checkClash({ startDate: day(11), startTime: "0000", endDate: day(13), endTime: "2359" });
    expect(res).toMatchObject({ ok: true, data: [expect.stringMatching(/^AL .* · pending$/), expect.stringMatching(/^RF @ BDK /)] });
    await actions.withdrawRecord({ recordId: id });
    expect(await actions.checkClash({ startDate: day(11), startTime: "0000", endDate: day(11), endTime: "2359" })).toEqual({ ok: true, data: [] });
  });

  it("add for several men: one PROXY row each, in scope only, and each man is told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(5001, null); // WEI HAO's account, so he gets the DM
    await db.update(wbMember).set({ personId: pl6People[0] }).where(eq(wbMember.telegramUserId, 5001));
    await as(PS);
    const ev = { what: "DV driver course", place: "Maju", startDate: day(5), endDate: day(9), timeStart: "0000", timeEnd: "2359" };
    expect(await actions.addEventFor({ ...ev, personIds: [...pl6People, pl5Person] })).toEqual({ ok: false, error: "LCP PARTHIV isn't in your scope." });
    expect(await actions.addEventFor({ ...ev, personIds: pl6People })).toEqual({ ok: true, data: { count: 3 } });
    const rows = await db.select().from(wbRecord);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.createdVia === "PROXY" && r.memberId === null && r.state === "RECORDED" && r.detail === "DV DRIVER COURSE @ MAJU")).toBe(true);
    expect(sends()).toMatchObject([{ payload: { chat_id: 5001, text: expect.stringMatching(/^📝 LCP CHUN HEI recorded this for you/) } }]);
    // a trooper with no grants can't
    await as(TROOPER);
    expect(await actions.addEventFor({ ...ev, personIds: [pl6People[0]] })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in your scope/) });
    expect(await db.select().from(wbRecord).where(and(eq(wbRecord.personId, pl6People[0])))).toHaveLength(1);
  });
});
