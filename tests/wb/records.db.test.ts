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
    if (method === "getFile") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: true, result: { file_id: (payload as any).file_id, file_unique_id: "u", file_path: "photos/file_1.jpg" } } as any;
    }
    const id = ++tg.next;
    const photo = method === "sendPhoto" ? { photo: [{ file_id: `small-${id}`, file_unique_id: "s", width: 90, height: 90 }, { file_id: `PHOTO-${id}`, file_unique_id: "l", width: 1280, height: 960 }] } : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: { message_id: id, date: 0, chat: { id: 0, type: "private" }, ...photo } } as any;
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

type Role = "PS" | "PC" | "GC" | "OC" | "ASA" | "ADMIN";
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
const out = async () => (await import("@/lib/wb/telegram/courier")).courier();
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

describe("approval chain (DB, 2026-10-14)", () => {
  const PC = 3001;
  const OC = 4001;
  const psApplies = async () => {
    await as(PS);
    const res = await actions.applyLeave(al());
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };

  it("a PS's own request: he can't decide it, the PC can", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(PC, pl6People[0], [{ role: "PC", subunitId: pl6 }]);
    const { recordId, approved } = await psApplies();
    expect(approved).toBe(false);
    const { pendingFor } = await import("@/lib/wb/records");
    expect((await pendingFor(await actorOf(PS))).map((r) => r.id)).not.toContain(recordId);
    expect((await pendingFor(await actorOf(PC))).map((r) => r.id)).toContain(recordId);

    expect(await actions.decideRecord({ recordId, action: "approve" })).toEqual({ ok: false, error: "You can't decide your own request. It's with the commander above you." });
    await as(PC);
    expect(await actions.decideRecord({ recordId, action: "approve" })).toEqual({ ok: true, data: { state: "APPROVED" } });
    expect(await leaveOf(PS)).toBe(11);
  });

  it("a PC's own request goes to COY HQ's chat too, for OC/2IC/CSM", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const [{ id: hq }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "COY HQ"));
    await db.insert(wbCommanderChat).values({ subunitId: hq, chatId: -1009, threadId: null, chatTitle: "COY HQ" });
    await member(PC, pl6People[0], [{ role: "PC", subunitId: pl6 }]);
    await as(PC);
    const res = await actions.applyLeave(al());
    if (!res.ok) throw new Error(res.error);
    expect(sends().map((c) => c.payload.chat_id)).toEqual([-1006, -1009]);
    expect(await db.select().from(wbCard).where(eq(wbCard.recordId, res.data.recordId))).toHaveLength(2);
  });

  it("an ADMIN may approve his own", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(TROOPER, irfan);
    await member(PS, chunHei, [{ role: "PS", subunitId: pl6 }, { role: "ADMIN" }]);
    const { recordId } = await psApplies();
    expect(await actions.decideRecord({ recordId, action: "approve" })).toEqual({ ok: true, data: { state: "APPROVED" } });
  });

  it("OC/2IC/CSM: saved approved, leave spent, the card says no approval needed and has no Undo", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(OC, pl6People[1], [{ role: "OC" }]);
    await as(OC);
    const res = await actions.applyLeave(al());
    if (!res.ok) throw new Error(res.error);
    expect(res.data.approved).toBe(true);
    const [row] = await db.select().from(wbRecord).where(eq(wbRecord.id, res.data.recordId));
    expect(row).toMatchObject({ state: "APPROVED", decisionNote: "No approval needed" });
    expect(await leaveOf(OC)).toBe(11);

    const card = sends().find((c) => c.payload.chat_id === -1006)!;
    expect(card.payload.text).toContain("✅ No approval needed");
    expect(JSON.stringify(card.payload.reply_markup)).not.toContain("Undo");

    expect(await actions.undoDecision({ recordId: res.data.recordId })).toMatchObject({ ok: false, error: expect.stringMatching(/Void it instead/) });
    // voiding gives the days back
    expect(await actions.voidEntry({ recordId: res.data.recordId, reason: "Not going" })).toMatchObject({ ok: true });
    expect(await leaveOf(OC)).toBe(14);
  });
});

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

    const audits = await db.select({ action: wbAudit.action, via: wbAudit.via }).from(wbAudit).where(eq(wbAudit.entityId, id)).orderBy(wbAudit.at);
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

// ------------------------------------------------------------------ Phase 3: medical

const medical = await import("@/lib/wb/actions/medical");
const { POST: photoRoute } = await import("@/app/api/wb/photo/route");
const { GET: fileRoute } = await import("@/app/api/wb/file/[recordId]/route");
const { readDiagnoses } = await import("@/lib/wb/medical");
const { recordView } = await import("@/lib/wb/records");

/** The Mini App uploading a photo as whoever is signed in: returns the token. */
async function uploadPhoto() {
  const fd = new FormData();
  fd.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "mc.jpg", { type: "image/jpeg" }));
  const res = await photoRoute(new Request("http://localhost/api/wb/photo", { method: "POST", body: fd }));
  const body = (await res.json()) as { token?: string; error?: string };
  if (!res.ok) throw new Error(body.error);
  return body.token!;
}
const getPhoto = (recordId: string) => fileRoute(new Request(`http://localhost/api/wb/file/${recordId}`), { params: Promise.resolve({ recordId }) });

const sick = (over: Record<string, unknown> = {}) => ({ where: "RSO" as const, date: day(0), clinic: "raffles medical", symptoms: "Fever and sore throat", ...over });
const mc = (over: Record<string, unknown> = {}) => ({ kind: "MC" as const, category: "Respiratory" as const, diagnosis: "ACUTE PHARYNGITIS", startDate: day(0), endDate: day(2), seenBy: null, ...over });
const status = (over: Record<string, unknown> = {}) => ({ permanent: false, type: "LIGHT DUTY" as const, other: "", startDate: day(3), endDate: day(6), ...over });

/** PTE IRFAN reports sick outside; his PS approves from the Mini App. */
async function approvedRso() {
  await setup();
  await as(TROOPER);
  const res = await actions.reportSick(sick());
  if (!res.ok) throw new Error(res.error);
  await as(PS);
  await actions.decideRecord({ recordId: res.data.recordId, action: "approve" });
  return res.data.recordId;
}

describe("medical (DB)", () => {
  it("RSO: pending, card shows the symptoms, approval DMs an Update outcome button", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(TROOPER);
    const res = await actions.reportSick(sick());
    expect(res).toMatchObject({ ok: true, data: { delivery: "sent" } });
    const id = res.ok ? res.data.recordId : "";
    const [rec] = await db.select().from(wbRecord).where(eq(wbRecord.id, id));
    expect(rec).toMatchObject({ kind: "RSO", state: "PENDING", absent: false, location: "RAFFLES MEDICAL", reason: "Fever and sore throat" });
    expect(String(sends()[0].payload.text)).toContain("Report sick (outside) · PTE IRFAN\nSLR · PLATOON 6\nRSO ");
    expect(String(sends()[0].payload.text)).toContain("@ RAFFLES MEDICAL\nSymptoms: Fever and sore throat");

    tg.calls = [];
    await as(PS);
    await actions.decideRecord({ recordId: id, action: "approve" });
    const dm = sends().find((c) => c.payload.chat_id === TROOPER)!;
    expect(String(dm.payload.text)).toMatch(/Go now\. After you've seen the doctor, tap Update outcome/);
    expect(dm.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "💊 Update outcome", url: `https://t.me/sabrecoybot/app?startapp=records__${id}__outcome` }]] });

    // RSI: not absent; and the checks
    await as(TROOPER);
    expect(await actions.reportSick(sick({ where: "RSI", clinic: "" }))).toMatchObject({ ok: true });
    expect((await db.select().from(wbRecord).where(eq(wbRecord.kind, "RSI")))[0]).toMatchObject({ absent: false, location: "" });
    expect(await actions.reportSick(sick({ clinic: "" }))).toEqual({ ok: false, error: "Say which clinic or hospital." });
    expect(await actions.reportSick(sick({ date: day(-1) }))).toEqual({ ok: false, error: "That day is over. Tell your PS instead." });
  });

  it("outcome after an RSO: MC + 2 statuses + photo; the card never carries the diagnosis", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    tg.calls = [];
    const token = await uploadPhoto();
    const photo = tg.calls.find((c) => c.method === "sendPhoto")!;
    expect(photo.payload.chat_id).toBe(TROOPER); // his own DM, nowhere else
    const res = await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [status(), status({ type: "OTHER", other: "excuse rmj", permanent: true, startDate: day(4), endDate: null })], photoToken: token, onensUploaded: false });
    expect(res).toMatchObject({ ok: true, data: { anchorId: rso, delivery: "sent", nothing: false } });

    const rows = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    expect(rows).toHaveLength(3);
    // the largest size the fake returned, on every row
    expect(rows.every((r) => r.state === "RECORDED" && r.evidenceFileId?.startsWith("PHOTO-") && r.createdAt.getTime() === rows[0].createdAt.getTime())).toBe(true);
    const mcRow = rows.find((r) => r.kind === "MC")!;
    expect(mcRow).toMatchObject({ absent: true, mcCategory: "Respiratory", diagnosis: "ACUTE PHARYNGITIS", onens: "OWED", seenBy: null });
    expect(rows.filter((r) => r.kind === "STATUS").map((r) => [r.detail, r.absent, r.endAt === null])).toEqual([
      ["LIGHT DUTY", false, false],
      ["EXCUSE RMJ", false, true],
    ]);
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, rso)))[0].outcomeAt).not.toBeNull();

    const card = sends().find((c) => c.payload.chat_id === -1006)!;
    const text = String(card.payload.text);
    expect(text).toMatch(/^📝 Outcome recorded\n\nWhat the doctor gave · PTE IRFAN\nSLR · PLATOON 6\nMC 3 days · .* · Respiratory\nLIGHT DUTY .*\nEXCUSE RMJ from .* \(permanent\)\n☁️ Still to upload to ONENS$/);
    expect(card.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open", url: `https://t.me/sabrecoybot/app?startapp=records__${rso}` }]] });
    for (const c of tg.calls.filter((x) => x.method !== "sendPhoto")) expect(JSON.stringify(c.payload)).not.toContain("PHARYNGITIS");
    expect(tg.calls.filter((c) => c.method === "sendPhoto" && c.payload.chat_id !== TROOPER)).toEqual([]);
    expect(String(sends().find((c) => c.payload.chat_id === TROOPER)!.payload.text)).toMatch(/^✅ Recorded[\s\S]*Still to upload to ONENS/);

    // once recorded, the PS can't undo his approval
    await as(PS);
    expect(await actions.undoDecision({ recordId: rso })).toEqual({ ok: false, error: "He's already recorded what the doctor gave him. Void it instead." });
  });

  it("who sees the diagnosis and photo: the trooper and his PS do (audited); a GC and another platoon's PS don't", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: await uploadPhoto(), onensUploaded: true });
    const [mcRow] = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    const view = (await recordView(mcRow.id))!;
    expect(view).not.toHaveProperty("diagnosis");
    expect(view).not.toHaveProperty("evidenceFileId");

    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    const gc = await member(3001, null, [{ role: "GC", campId: slr.id }]);
    const otherPs = await member(3002, null, [{ role: "PS", subunitId: (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 5")))[0].id }]);
    await db.delete(wbAudit);

    for (const who of [await actorOf(3001), await actorOf(3002)]) expect((await readDiagnoses(who, [view], "MINIAPP")).size).toBe(0);
    expect(await db.select().from(wbAudit)).toEqual([]);
    expect((await readDiagnoses(await actorOf(PS), [view], "MINIAPP")).get(mcRow.id)).toBe("ACUTE PHARYNGITIS");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    try {
      for (const tgId of [3001, 3002]) {
        await as(tgId);
        expect((await getPhoto(mcRow.id)).status).toBe(404);
      }
      await as(PS);
      const ok = await getPhoto(mcRow.id);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^https:\/\/api\.telegram\.org\/file\/bot.+\/photos\/file_1\.jpg$/);
      await as(TROOPER);
      expect((await getPhoto(mcRow.id)).status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
    const reads = await db.select({ memberId: wbAudit.memberId, after: wbAudit.after }).from(wbAudit).where(eq(wbAudit.action, "read-medical")).orderBy(wbAudit.at);
    const ps = (await db.select().from(wbMember).where(eq(wbMember.telegramUserId, PS)))[0].id;
    const trooper = (await db.select().from(wbMember).where(eq(wbMember.telegramUserId, TROOPER)))[0].id;
    expect(reads).toEqual([
      { memberId: ps, after: { field: "diagnosis" } },
      { memberId: ps, after: { field: "photo" } },
      { memberId: trooper, after: { field: "photo" } },
    ]);
    expect(reads.some((r) => r.memberId === gc.id || r.memberId === otherPs.id)).toBe(false);
  });

  it("standalone MC from a civilian doctor, then a correction that keeps the photo", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(TROOPER);
    // who he saw is required when nothing above says so
    const token = await uploadPhoto();
    expect(await medical.recordOutcome({ anchorId: null, mc: mc(), statuses: [], photoToken: token, onensUploaded: false })).toEqual({
      ok: false,
      error: "Say who you saw: the camp MO or a civilian doctor.",
    });
    const first = await medical.recordOutcome({ anchorId: null, mc: mc({ seenBy: "CIVILIAN" }), statuses: [status()], photoToken: token, onensUploaded: false });
    expect(first).toMatchObject({ ok: true });
    const head = first.ok ? first.data.anchorId : "";
    const rows = await db.select().from(wbRecord);
    expect(rows.find((r) => r.id === head)).toMatchObject({ kind: "MC", parentId: null, seenBy: "CIVILIAN", onens: "OWED" });
    expect(rows.find((r) => r.kind === "STATUS")).toMatchObject({ parentId: head });

    tg.calls = [];
    const fixed = await medical.recordOutcome({ anchorId: head, mc: mc({ seenBy: "CIVILIAN", endDate: day(4) }), statuses: [], photoToken: null, onensUploaded: true });
    expect(fixed).toMatchObject({ ok: true });
    const after = await db.select().from(wbRecord);
    expect(after.filter((r) => r.state === "CANCELLED").map((r) => [r.kind, r.decisionNote])).toEqual([
      ["MC", "Corrected by PTE IRFAN"],
      ["STATUS", "Corrected by PTE IRFAN"],
    ]);
    const live = after.filter((r) => r.state === "RECORDED");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ kind: "MC", onens: "DONE", evidenceFileId: rows[0].evidenceFileId });
    const card = String(sends().find((c) => c.payload.chat_id === -1006)!.payload.text);
    expect(card).toMatch(/^✏️ Outcome corrected[\s\S]*MC 5 days[\s\S]*\n\nReplaces\nMC 3 days .*\nLIGHT DUTY /);
    // the old card is edited to show it was replaced
    expect(String(edits()[0].payload.text)).toMatch(/🚫 Corrected by PTE IRFAN$/);
  });

  it("refusals: a pending RSO, someone else's visit, a forged or borrowed photo token, no photo", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(TROOPER);
    const res = await actions.reportSick(sick());
    const rso = res.ok ? res.data.recordId : "";
    const token = await uploadPhoto();
    expect(await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: token, onensUploaded: false })).toEqual({
      ok: false,
      error: "Your commander hasn't approved this report sick yet.",
    });
    await as(PS);
    await actions.decideRecord({ recordId: rso, action: "approve" });
    // the PS can't record the trooper's outcome, even with the trooper's token
    expect(await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: token, onensUploaded: false })).toEqual({ ok: false, error: "That photo has expired. Add it again." });
    expect(await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: null, onensUploaded: false })).toEqual({ ok: false, error: "That isn't yours." });
    await as(TROOPER);
    expect(await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: `${token.split(".")[0]}.forged`, onensUploaded: false })).toMatchObject({ ok: false });
    expect(await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: null, onensUploaded: false })).toEqual({ ok: false, error: "Add a photo of the document." });
    expect(await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso))).toEqual([]);
  });

  it("nothing given: the visit is answered and nothing is added", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    expect(await medical.recordOutcome({ anchorId: rso, mc: null, statuses: [], photoToken: null, onensUploaded: false })).toMatchObject({ ok: true, data: { nothing: true } });
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, rso)))[0].outcomeAt).not.toBeNull();
    expect(await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso))).toEqual([]);
    // standalone with nothing is refused
    expect(await medical.recordOutcome({ anchorId: null, mc: null, statuses: [], photoToken: null, onensUploaded: false })).toEqual({ ok: false, error: "Nothing to record." });
  });

  it("void of an RSO voids its outcome too, and refunds nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [status()], photoToken: await uploadPhoto(), onensUploaded: false });
    await as(PS);
    tg.calls = [];
    expect(await actions.voidEntry({ recordId: rso, reason: "Wrong man" })).toEqual({ ok: true, data: { state: "CANCELLED" } });
    const rows = await db.select().from(wbRecord);
    expect(rows.every((r) => r.state === "CANCELLED" && r.decisionNote === "Voided by LCP CHUN HEI: Wrong man")).toBe(true);
    expect(await leaveOf(TROOPER)).toBe(14);
    // the RSO's approval card and the outcome card are both edited
    expect(edits().some((e) => String(e.payload.text).startsWith("📝 Outcome recorded") && String(e.payload.text).endsWith("🚫 Voided by LCP CHUN HEI: Wrong man"))).toBe(true);
    expect(edits().some((e) => String(e.payload.text).startsWith("Report sick (outside)") || String(e.payload.text).includes("🚫 Voided by LCP CHUN HEI: Wrong man"))).toBe(true);
    const [audit] = await db.select().from(wbAudit).where(and(eq(wbAudit.action, "void"), eq(wbAudit.entityId, rso)));
    expect((audit.after as { alsoVoided: string[] }).alsoVoided).toHaveLength(2);
  });

  it("ONENS: the trooper marks it uploaded once; a GC can't", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    await medical.recordOutcome({ anchorId: rso, mc: mc(), statuses: [], photoToken: await uploadPhoto(), onensUploaded: false });
    const [mcRow] = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    await member(3001, null, [{ role: "GC", campId: slr.id }]);
    await as(3001);
    expect(await medical.markUploaded({ recordId: mcRow.id })).toEqual({ ok: false, error: "That isn't yours." });
    await as(TROOPER);
    tg.calls = [];
    expect(await medical.markUploaded({ recordId: mcRow.id })).toEqual({ ok: true, data: { onens: "DONE" } });
    expect(String(edits()[0].payload.text)).toContain("☁️ Uploaded to ONENS");
    expect(await medical.markUploaded({ recordId: mcRow.id })).toEqual({ ok: false, error: "Nothing is owed on ONENS for that." });
  });
});
