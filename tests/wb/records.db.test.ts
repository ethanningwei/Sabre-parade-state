// The timeline's writes through the database: submit, decide, undo, void,
// withdraw, Say why, proxy events, outcomes and ONENS, called as the bot and
// the Mini App call them, with the recording Courier: who was told and which
// cards moved, in domain terms. Telegram rendering is courier.db.test.ts's;
// what a card says is checked here through the card renderers on the
// record's view. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, duty, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbCard, wbCommanderChat, wbGrant, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { decide, sayWhy, submit, undo, voidRecord, withdraw, type NewRecord } from "@/lib/wb/decide";
import { outcomeOrder } from "@/lib/wb/domain/describe";
import { eventFrom, leaveFrom, maFrom, offFrom, sickFrom, type OwnRecord } from "@/lib/wb/input";
import { markOnens, saveOutcome, type McInput, type OutcomeInput, type StatusInput } from "@/lib/wb/outcome";
import { clashFor, pendingFor, recordView, recordViews } from "@/lib/wb/records";
import { cardKeyboard, cardText, outcomeCardText } from "@/lib/wb/telegram/cards";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day, member, ok, reachable as dbUp } from "./writes";

let reachable = true;
let pl6: string;
let irfan: string; // PTE IRFAN, SLR, PLATOON 6: the trooper
let chunHei: string; // LCP CHUN HEI, SLR, PLATOON 6: the PS
const pl6People: string[] = [];
let pl5Person: string;

beforeAll(async () => {
  reachable = await dbUp();
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
  const byName = async (name: string) => (await db.select({ id: person.id }).from(person).where(and(eq(person.name, name), eq(person.active, true))))[0].id;
  irfan = await byName("IRFAN");
  chunHei = await byName("CHUN HEI");
  pl6People.push(await byName("WEI HAO"), await byName("JOSHUA LAU"), await byName("XIAO HENG"));
  pl5Person = await byName("PARTHIV");
});
beforeEach(async () => {
  if (!reachable) return;
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

const leaveOf = async (tgId: number) => (await db.select({ l: wbMember.leaveLeft }).from(wbMember).where(eq(wbMember.telegramUserId, tgId)))[0].l;
const view = async (id: string) => (await recordView(id))!;

const TROOPER = 1001;
const PS = 2001;

async function setup() {
  await member(TROOPER, irfan);
  await member(PS, chunHei, [{ role: "PS", subunitId: pl6 }]);
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

/** His own record, as the Mini App submits it. */
async function own(c: ReturnType<typeof recordingCourier>, tgId: number, rec: OwnRecord) {
  const by = await acting(tgId);
  const res = await submit(c, by, [{ ...rec, personId: by.actor.personId!, memberId: by.actor.id, createdVia: "SELF" } satisfies NewRecord]);
  return ok(res).records[0];
}
const applyAl = async (c = recordingCourier(), tgId = TROOPER, over: Record<string, unknown> = {}) => (await own(c, tgId, leaveFrom(al(over), (await leaveOf(tgId)) ?? 0))).id;

describe("approval chain (DB, 2026-10-14)", () => {
  const PC = 3001;
  const OC = 4001;

  it("a PS's own request: he can't decide it, the PC can", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(PC, pl6People[0], [{ role: "PC", subunitId: pl6 }]);
    const c = recordingCourier();
    const id = await applyAl(c, PS);
    expect((await view(id)).state).toBe("PENDING");
    expect((await pendingFor((await acting(PS)).actor)).map((r) => r.id)).not.toContain(id);
    expect((await pendingFor((await acting(PC)).actor)).map((r) => r.id)).toContain(id);

    expect(await decide(c, await acting(PS), id, "approve")).toEqual({ ok: false, error: "You can't decide your own request. It's with the commander above you." });
    expect(await decide(c, await acting(PC), id, "approve")).toMatchObject({ ok: true, value: { state: "APPROVED" } });
    expect(await leaveOf(PS)).toBe(11);
  });

  it("an ADMIN may approve his own", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(TROOPER, irfan);
    await member(PS, chunHei, [{ role: "PS", subunitId: pl6 }, { role: "ADMIN" }]);
    const id = await applyAl(recordingCourier(), PS);
    expect(await decide(recordingCourier(), await acting(PS), id, "approve")).toMatchObject({ ok: true, value: { state: "APPROVED" } });
  });

  it("OC/2IC/CSM: saved approved, leave spent, the card says no approval needed and has no Undo", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(OC, pl6People[1], [{ role: "OC" }]);
    const c = recordingCourier();
    const id = await applyAl(c, OC);
    expect(await view(id)).toMatchObject({ state: "APPROVED", decisionNote: "No approval needed" });
    expect(await leaveOf(OC)).toBe(11);
    expect(c.sent).toEqual([{ postCard: { record: id } }]);
    expect(cardText(await view(id))).toContain("✅ No approval needed");
    expect(JSON.stringify(cardKeyboard(await view(id), "sabrecoybot"))).not.toContain("Undo");

    expect(await undo(c, await acting(OC), id)).toMatchObject({ ok: false, error: expect.stringMatching(/Void it instead/) });
    // voiding gives the days back
    expect(await voidRecord(c, await acting(OC), id, "Not going")).toMatchObject({ ok: true });
    expect(await leaveOf(OC)).toBe(14);
  });
});

describe("timeline (DB)", () => {
  it("AL: saved PENDING with its card; approve spends and tells him; undo refunds and tells him", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const id = await applyAl(c);

    expect(await db.select().from(wbRecord).where(eq(wbRecord.id, id))).toMatchObject([
      { kind: "AL", state: "PENDING", leaveDays: 3, detail: "AL @ JOHOR BAHRU", location: "JOHOR BAHRU", reason: "Holiday", createdVia: "SELF", absent: true },
    ]);
    expect(c.sent).toEqual([{ postCard: { record: id } }]);
    const text = cardText(await view(id));
    expect(text).toContain("⏳ Approval needed\n\nAnnual leave · PTE IRFAN\nSLR · PLATOON 6");
    expect(text).toContain("3 days of leave · 14 left, 11 after this\n@ JOHOR BAHRU · Holiday");
    expect(cardKeyboard(await view(id), "sabrecoybot")).toEqual({
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `d:${id}:a` },
          { text: "❌ Reject", callback_data: `d:${id}:r` },
        ],
        [{ text: "Open", url: `https://t.me/sabrecoybot/app?startapp=records__${id}` }],
      ],
    });

    c.sent.length = 0;
    expect(await decide(c, await acting(PS), id, "approve")).toMatchObject({ ok: true, value: { state: "APPROVED" } });
    expect(await leaveOf(TROOPER)).toBe(11);
    expect(c.sent).toEqual([{ redraw: { record: id } }, { send: { telegramId: TROOPER }, text: expect.stringContaining("✅ Approved by LCP CHUN HEI") }]);
    expect(cardText(await view(id))).toMatch(/✅ Approved by LCP CHUN HEI$/);
    expect((c.sent[1] as { text: string }).text).toContain("3 days of leave · 11 left");

    c.sent.length = 0;
    expect(await undo(c, await acting(PS), id)).toMatchObject({ ok: true, value: { state: "PENDING" } });
    expect(await leaveOf(TROOPER)).toBe(14);
    expect(c.sent).toEqual([{ redraw: { record: id } }, { send: { telegramId: TROOPER }, text: expect.stringMatching(/^⚠️ LCP CHUN HEI took that decision back/) }]);

    const audits = await db.select({ action: wbAudit.action, via: wbAudit.via }).from(wbAudit).where(eq(wbAudit.entityId, id)).orderBy(wbAudit.at);
    expect(audits).toEqual([
      { action: "submit", via: "MINIAPP" },
      { action: "approve", via: "MINIAPP" },
      { action: "undo", via: "MINIAPP" },
    ]);
  });

  it("reject, then Say why: the note reaches the record, the card and the trooper; rejecting costs nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const id = await applyAl(c);
    expect(await decide(c, await acting(PS, "BOT"), id, "reject")).toMatchObject({ ok: true });
    expect(await leaveOf(TROOPER)).toBe(14);
    c.sent.length = 0;
    expect(await sayWhy(c, await acting(PS, "BOT"), id, "Camp is short that weekend")).toMatchObject({ ok: true });
    expect(await view(id)).toMatchObject({ state: "REJECTED", decisionNote: "Camp is short that weekend" });
    expect(cardText(await view(id))).toMatch(/❌ Rejected by LCP CHUN HEI\nWhy: Camp is short that weekend$/);
    // Say why is gone once there's a reason; Undo stays
    expect(cardKeyboard(await view(id), "sabrecoybot").inline_keyboard[0].map((b) => b.text)).toEqual(["↩ Undo"]);
    expect(c.sent).toEqual([{ redraw: { record: id } }, { send: { telegramId: TROOPER }, text: expect.stringMatching(/^💬 Why LCP CHUN HEI said no[\s\S]*Camp is short that weekend$/) }]);
    // only the decider, and only with something to say
    expect(await sayWhy(c, await acting(PS), id, "  ")).toEqual({ ok: false, error: "Type a reason." });
  });

  it("two approvers racing: exactly one wins, leave is spent once, and the loser's card is redrawn", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(2002, null, [{ role: "OC" }]);
    const id = await applyAl();
    const [ca, cb] = [recordingCourier(), recordingCourier()];
    const [a, b] = await Promise.all([decide(ca, await acting(PS, "BOT"), id, "approve"), decide(cb, await acting(2002, "BOT"), id, "reject")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [loser, loserSent] = a.ok ? [b, cb.sent] : [a, ca.sent];
    expect(loser).toMatchObject({ ok: false, error: expect.stringMatching(/^Already (approved|rejected) by /) });
    expect(loserSent).toEqual([{ redraw: { record: id } }]);
    expect(await leaveOf(TROOPER)).toBe((await view(id)).state === "APPROVED" ? 11 : 14);
  });

  it("only the platoon's PC/PS or company HQ decide; a GC in the chat doesn't, and nobody is told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    await member(3001, null, [{ role: "GC", campId: slr.id }]);
    await member(3002, null, [{ role: "PS", subunitId: (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 5")))[0].id }]);
    const id = await applyAl();
    const c = recordingCourier();
    for (const who of [3001, 3002]) {
      expect(await decide(c, await acting(who), id, "approve")).toEqual({ ok: false, error: "Only PLATOON 6's PC or PS can decide this." });
    }
    expect((await view(id)).state).toBe("PENDING");
    expect(c.sent).toEqual([]);
  });

  it("undo: only the decider, only for ten minutes", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(2003, null, [{ role: "PC", subunitId: pl6 }]);
    const id = await applyAl();
    const c = recordingCourier();
    await decide(c, await acting(PS, "BOT"), id, "approve");
    expect(await undo(c, await acting(2003, "BOT"), id)).toMatchObject({ ok: false, error: "Only LCP CHUN HEI can take that back." });
    await db.update(wbRecord).set({ decidedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(wbRecord.id, id));
    expect(await undo(c, await acting(PS, "BOT"), id)).toMatchObject({ ok: false, error: expect.stringMatching(/^Too late/) });
    expect(await leaveOf(TROOPER)).toBe(11);
  });

  it("approving more leave than he has left is refused, changes nothing and tells nobody", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await db.update(wbMember).set({ leaveLeft: 2 }).where(eq(wbMember.telegramUserId, TROOPER));
    const c = recordingCourier();
    expect(await decide(c, await acting(PS), id, "approve")).toEqual({ ok: false, error: "PTE IRFAN has only 2 days of leave left, and this needs 3." });
    expect((await view(id)).state).toBe("PENDING");
    expect(await db.select().from(wbAudit).where(eq(wbAudit.action, "approve"))).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("void needs a reason, refunds approved leave, and tells the trooper", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    const c = recordingCourier();
    await decide(c, await acting(PS, "BOT"), id, "approve");
    expect(await voidRecord(c, await acting(PS), id, "")).toEqual({ ok: false, error: "Say why you're voiding it." });
    c.sent.length = 0;
    expect(await voidRecord(c, await acting(PS), id, "Entered twice")).toMatchObject({ ok: true, value: { state: "CANCELLED" } });
    expect(await leaveOf(TROOPER)).toBe(14);
    expect(await view(id)).toMatchObject({ state: "CANCELLED", decisionNote: "Voided by LCP CHUN HEI: Entered twice" });
    expect(cardText(await view(id))).toMatch(/🚫 Voided by LCP CHUN HEI: Entered twice$/);
    expect(c.sent).toEqual([{ redraw: { record: id } }, { send: { telegramId: TROOPER }, text: expect.stringMatching(/^🚫 LCP CHUN HEI voided this[\s\S]*3 days of leave back · 14 left$/) }]);
    // a cancelled one can't be voided again, and a void can't be undone
    expect(await voidRecord(c, await acting(PS), id, "again")).toMatchObject({ ok: false });
    expect(await undo(c, await acting(PS), id)).toMatchObject({ ok: false });
  });

  it("withdraw: his own, and only while pending; a decision after it is told it's gone", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    const c = recordingCourier();
    expect(await withdraw(c, await acting(PS), id)).toEqual({ ok: false, error: "That isn't yours to withdraw." });
    expect(await withdraw(c, await acting(TROOPER), id)).toMatchObject({ ok: true, value: { state: "WITHDRAWN" } });
    expect(c.sent).toEqual([{ redraw: { record: id } }]);
    expect(cardText(await view(id))).toMatch(/↩️ Withdrawn$/);
    expect(await withdraw(c, await acting(TROOPER), id)).toMatchObject({ ok: false, error: expect.stringMatching(/still waiting/) });
    expect(await decide(c, await acting(PS), id, "approve")).toEqual({ ok: false, error: "Already withdrawn." });
  });

  it("an unregistered member can't make any of these writes", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await db.update(wbMember).set({ registeredAt: null }).where(eq(wbMember.telegramUserId, PS));
    const c = recordingCourier();
    expect(await decide(c, await acting(PS), id, "approve")).toEqual({ ok: false, error: "Register first." });
    expect(await decide(c, await acting(PS, "BOT"), id, "approve")).toEqual({ ok: false, error: "Open Sabre and register first." });
    expect((await view(id)).state).toBe("PENDING");
    expect(c.sent).toEqual([]);
  });

  it("MA and events are recorded straight away, with an info card", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const ma = await own(c, TROOPER, maFrom({ date: day(2), time: "15:30", place: "national skin centre" }));
    await own(c, TROOPER, eventFrom({ what: "IPPT", place: "Maju camp", startDate: day(4), endDate: day(4), timeStart: "0800", timeEnd: "1200" }));
    const rows = await db.select().from(wbRecord).orderBy(wbRecord.startAt);
    expect(rows).toMatchObject([
      { kind: "MA", state: "RECORDED", maTiming: "1530", location: "NATIONAL SKIN CENTRE" },
      { kind: "EVENT", state: "RECORDED", detail: "IPPT @ MAJU CAMP 0800-1200H" },
    ]);
    expect(c.sent.map((s) => "postCard" in s && s.postCard)).toEqual([{ record: ma.id }, { record: rows[1].id }]);
    expect(cardText(ma)).toMatch(/^📝 Recorded, no approval needed/);
    expect(cardKeyboard(ma, "sabrecoybot")).toEqual({ inline_keyboard: [[{ text: "Open", url: expect.stringContaining("records__") }]] });
  });

  it("an OFF with no balance needed; someone else's personId is refused", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    await own(c, TROOPER, offFrom({ startDate: day(3), startTime: "0000", endDate: day(3), endTime: "2359" }));
    expect(await db.select().from(wbRecord)).toMatchObject([{ kind: "OFF", state: "PENDING", leaveDays: null }]);
    const by = await acting(TROOPER);
    const theirs = { ...offFrom({ startDate: day(4), startTime: "0000", endDate: day(4), endTime: "2359" }), personId: chunHei, memberId: by.actor.id, createdVia: "SELF" as const };
    expect(await submit(c, by, [theirs])).toEqual({ ok: false, error: "That isn't yours." });
  });

  it("clash: finds his live records and open duties, ignores dead ones", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await applyAl();
    await applyAl(recordingCourier(), TROOPER, { startDate: day(20), endDate: day(20), days: [day(20)] }); // elsewhere
    const [bdk] = await db.select({ id: camp.id, coyId: camp.coyId }).from(camp).where(eq(camp.name, "BDK"));
    await db.insert(duty).values({ coyId: bdk.coyId, type: "RF", rank: "PTE", name: "IRFAN", personId: irfan, campId: bdk.id, startDate: day(12), endDate: day(13), sortOrder: 99 });
    const range = (from: number, to: number) => ({ startAt: new Date(`${day(from)}T00:00:00+08:00`), endAt: new Date(`${day(to)}T23:59:00+08:00`) });
    expect(await clashFor(irfan, range(11, 13))).toEqual([expect.stringMatching(/^AL .* · pending$/), expect.stringMatching(/^RF @ BDK /)]);
    await withdraw(recordingCourier(), await acting(TROOPER), id);
    expect(await clashFor(irfan, range(11, 11))).toEqual([]);
  });

  it("add for several men: one PROXY row each, in scope only, and each man is told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await member(5001, pl6People[0]); // WEI HAO's account, so he gets the DM
    const ev = eventFrom({ what: "DV driver course", place: "Maju", startDate: day(5), endDate: day(9), timeStart: "0000", timeEnd: "2359" });
    const proxy = (ids: string[]) => ids.map((personId) => ({ ...ev, personId, memberId: null, createdVia: "PROXY" as const }));
    const c = recordingCourier();
    expect(await submit(c, await acting(PS), proxy([...pl6People, pl5Person]))).toEqual({ ok: false, error: "LCP PARTHIV isn't in your scope." });
    expect(ok(await submit(c, await acting(PS), proxy(pl6People))).records).toHaveLength(3);
    const rows = await db.select().from(wbRecord);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.createdVia === "PROXY" && r.memberId === null && r.state === "RECORDED" && r.detail === "DV DRIVER COURSE @ MAJU")).toBe(true);
    // a DM to each man with an account, and no card
    expect(c.sent).toEqual([
      { send: { telegramId: 5001 }, text: expect.stringMatching(/^📝 LCP CHUN HEI recorded this for you/) },
      { send: { telegramId: null }, text: expect.any(String) },
      { send: { telegramId: null }, text: expect.any(String) },
    ]);
    // a trooper with no grants can't
    expect(await submit(c, await acting(TROOPER), proxy([pl6People[0]]))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in your scope/) });
    expect(await db.select().from(wbRecord).where(eq(wbRecord.personId, pl6People[0]))).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ Phase 3: medical

const sick = (over: Record<string, unknown> = {}) => ({ where: "RSO" as const, date: day(0), clinic: "raffles medical", symptoms: "Fever and sore throat", ...over });
const mc = (over: Partial<McInput> = {}): McInput => ({ kind: "MC", category: "Respiratory", diagnosis: "ACUTE PHARYNGITIS", startDate: day(0), endDate: day(2), seenBy: null, ...over });
const status = (over: Partial<StatusInput> = {}): StatusInput => ({ label: "LIGHT DUTY", startDate: day(3), endDate: day(6), ...over });
const outcome = (over: Partial<OutcomeInput>): OutcomeInput => ({ anchorId: null, mc: null, statuses: [], photoFileId: "PHOTO-1", onensUploaded: false, ...over });

/** PTE IRFAN reports sick outside; his PS approves. */
async function approvedRso() {
  await setup();
  const id = (await own(recordingCourier(), TROOPER, sickFrom(sick()))).id;
  await decide(recordingCourier(), await acting(PS), id, "approve");
  return id;
}

describe("medical (DB)", () => {
  it("RSO: pending, card shows the symptoms, approval DMs an Update outcome button", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const r = await own(c, TROOPER, sickFrom(sick()));
    expect(await db.select().from(wbRecord).where(eq(wbRecord.id, r.id))).toMatchObject([{ kind: "RSO", state: "PENDING", absent: false, location: "RAFFLES MEDICAL", reason: "Fever and sore throat" }]);
    expect(cardText(r)).toContain("Report sick (outside) · PTE IRFAN\nSLR · PLATOON 6\nRSO ");
    expect(cardText(r)).toContain("@ RAFFLES MEDICAL\nSymptoms: Fever and sore throat");

    c.sent.length = 0;
    await decide(c, await acting(PS), r.id, "approve");
    expect(c.sent[1]).toEqual({
      send: { telegramId: TROOPER },
      text: expect.stringMatching(/Go now\. After you've seen the doctor, tap Update outcome/),
      buttons: [[{ text: "💊 Update outcome", route: `records/${r.id}/outcome` }]],
    });

    // RSI: not absent
    await own(c, TROOPER, sickFrom(sick({ where: "RSI", clinic: "" })));
    expect((await db.select().from(wbRecord).where(eq(wbRecord.kind, "RSI")))[0]).toMatchObject({ absent: false, location: "" });
  });

  it("outcome after an RSO: MC + 2 statuses + photo; nothing told carries the diagnosis", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    const c = recordingCourier();
    const res = await saveOutcome(c, await acting(TROOPER), outcome({ anchorId: rso, mc: mc(), statuses: [status(), status({ label: "EXCUSE RMJ", startDate: day(4), endDate: null })] }));
    expect(res).toMatchObject({ ok: true, value: { anchorId: rso, delivery: "sent", nothing: false } });

    const rows = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === "RECORDED" && r.evidenceFileId === "PHOTO-1" && r.createdAt.getTime() === rows[0].createdAt.getTime())).toBe(true);
    const mcRow = rows.find((r) => r.kind === "MC")!;
    expect(mcRow).toMatchObject({ absent: true, mcCategory: "Respiratory", diagnosis: "ACUTE PHARYNGITIS", onens: "OWED", seenBy: null });
    expect(rows.filter((r) => r.kind === "STATUS").map((r) => [r.detail, r.absent, r.endAt === null])).toEqual([
      ["LIGHT DUTY", false, false],
      ["EXCUSE RMJ", false, true],
    ]);
    expect((await view(rso)).outcomeAt).not.toBeNull();

    expect(c.sent).toEqual([{ postCard: { record: mcRow.id }, replaces: [] }, { send: { telegramId: TROOPER }, text: expect.stringMatching(/^✅ Recorded[\s\S]*Still to upload to ONENS/) }]);
    const card = outcomeCardText(outcomeOrder(await recordViews(rows.map((r) => r.id))));
    expect(card).toMatch(/^📝 Outcome recorded\n\nWhat the doctor gave · PTE IRFAN\nSLR · PLATOON 6\nMC 3 days · .* · Respiratory\nLIGHT DUTY .*\nEXCUSE RMJ from .* \(permanent\)\n☁️ Still to upload to ONENS$/);
    expect(JSON.stringify(c.sent) + card).not.toContain("PHARYNGITIS");

    // once recorded, the PS can't undo his approval
    expect(await undo(c, await acting(PS), rso)).toEqual({ ok: false, error: "He's already recorded what the doctor gave him. Void it instead." });
  });

  it("standalone MC from a civilian doctor, then a correction that keeps the photo", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const by = await acting(TROOPER);
    // who he saw is required when nothing above says so
    expect(await saveOutcome(c, by, outcome({ mc: mc() }))).toEqual({ ok: false, error: "Say who you saw: the camp MO or a civilian doctor." });
    const head = ok(await saveOutcome(c, by, outcome({ mc: mc({ seenBy: "CIVILIAN" }), statuses: [status()] }))).anchorId;
    const rows = await db.select().from(wbRecord);
    expect(rows.find((r) => r.id === head)).toMatchObject({ kind: "MC", parentId: null, seenBy: "CIVILIAN", onens: "OWED" });
    expect(rows.find((r) => r.kind === "STATUS")).toMatchObject({ parentId: head });

    c.sent.length = 0;
    expect(await saveOutcome(c, by, outcome({ anchorId: head, mc: mc({ seenBy: "CIVILIAN", endDate: day(4) }), photoFileId: null, onensUploaded: true }))).toMatchObject({ ok: true });
    const after = await db.select().from(wbRecord);
    expect(after.filter((r) => r.state === "CANCELLED").map((r) => [r.kind, r.decisionNote])).toEqual([
      ["MC", "Corrected by PTE IRFAN"],
      ["STATUS", "Corrected by PTE IRFAN"],
    ]);
    const live = after.filter((r) => r.state === "RECORDED");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ kind: "MC", onens: "DONE", evidenceFileId: "PHOTO-1" });
    // the old card is redrawn (it now shows Corrected) and the new one says what it replaces
    expect(c.sent).toMatchObject([
      { redraw: { record: head } },
      { redraw: { record: expect.any(String) } },
      { postCard: { record: live[0].id }, replaces: [expect.stringMatching(/^MC 3 days /), expect.stringMatching(/^LIGHT DUTY /)] },
      { send: { telegramId: TROOPER }, text: expect.stringMatching(/^✏️ Corrected/) },
    ]);
  });

  it("refusals: a pending RSO, someone else's visit, no photo; nothing is told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const rso = (await own(recordingCourier(), TROOPER, sickFrom(sick()))).id;
    const c = recordingCourier();
    expect(await saveOutcome(c, await acting(TROOPER), outcome({ anchorId: rso, mc: mc() }))).toEqual({ ok: false, error: "Your commander hasn't approved this report sick yet." });
    await decide(recordingCourier(), await acting(PS), rso, "approve");
    expect(await saveOutcome(c, await acting(PS), outcome({ anchorId: rso, mc: mc() }))).toEqual({ ok: false, error: "That isn't yours." });
    expect(await saveOutcome(c, await acting(TROOPER), outcome({ anchorId: rso, mc: mc(), photoFileId: null }))).toEqual({ ok: false, error: "Add a photo of the document." });
    expect(await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso))).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("nothing given: the visit is answered and nothing is added", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    const c = recordingCourier();
    expect(await saveOutcome(c, await acting(TROOPER), outcome({ anchorId: rso, photoFileId: null }))).toMatchObject({ ok: true, value: { nothing: true } });
    expect((await view(rso)).outcomeAt).not.toBeNull();
    expect(await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso))).toEqual([]);
    expect(c.sent).toEqual([]);
    // standalone with nothing is refused
    expect(await saveOutcome(c, await acting(TROOPER), outcome({ photoFileId: null }))).toEqual({ ok: false, error: "Nothing to record." });
  });

  it("void of an RSO voids its outcome too, redraws both cards, and refunds nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await saveOutcome(recordingCourier(), await acting(TROOPER), outcome({ anchorId: rso, mc: mc(), statuses: [status()] }));
    const c = recordingCourier();
    expect(await voidRecord(c, await acting(PS), rso, "Wrong man")).toMatchObject({ ok: true, value: { state: "CANCELLED" } });
    const rows = await db.select().from(wbRecord);
    expect(rows.every((r) => r.state === "CANCELLED" && r.decisionNote === "Voided by LCP CHUN HEI: Wrong man")).toBe(true);
    expect(await leaveOf(TROOPER)).toBe(14);
    const kids = rows.filter((r) => r.parentId === rso).map((r) => r.id);
    expect(c.sent.filter((s) => "redraw" in s)).toEqual(expect.arrayContaining([{ redraw: { record: rso } }, ...kids.map((id) => ({ redraw: { record: id } }))]));
    const [audit] = await db.select().from(wbAudit).where(and(eq(wbAudit.action, "void"), eq(wbAudit.entityId, rso)));
    expect((audit.after as { alsoVoided: string[] }).alsoVoided).toHaveLength(2);
  });

  it("ONENS: the trooper marks it uploaded once; a GC can't", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await saveOutcome(recordingCourier(), await acting(TROOPER), outcome({ anchorId: rso, mc: mc() }));
    const [mcRow] = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    await member(3001, null, [{ role: "GC", campId: slr.id }]);
    const c = recordingCourier();
    expect(await markOnens(c, await acting(3001), mcRow.id)).toEqual({ ok: false, error: "That isn't yours." });
    expect(await markOnens(c, await acting(TROOPER, "BOT"), mcRow.id)).toMatchObject({ ok: true, value: { onens: "DONE" } });
    expect(c.sent).toEqual([{ redraw: { record: mcRow.id } }]);
    expect(await markOnens(c, await acting(TROOPER), mcRow.id)).toEqual({ ok: false, error: "Nothing is owed on ONENS for that." });
  });
});
