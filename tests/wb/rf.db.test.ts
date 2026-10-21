// RF requests and Extra/RF/SOL through the database, called as the bot and
// the Mini App call the writes, with the recording Courier: raise (the
// request's card), deploy (cards redrawn, the man, his platoon and the raiser
// told), the race for the last slot, close, stand down (reopens), Assign, the
// forecast and an approval card's line moving, and the evening round's
// digest and expiry. A refusal tells nobody. What a card says is checked
// through the card renderers on the request's view; Telegram rendering is
// courier.db.test.ts's, and a tap on the card is bot.db.test.ts's. Uses
// sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, camp, duty, person, subunit } from "@/lib/db/schema";
import { submit } from "@/lib/wb/decide";
import { wbAssignment, wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbMinManning, wbRecord, wbRfCard, wbRfRequest, wbShiftEvent, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import { rfButtons, rfCardText } from "@/lib/wb/domain/rf";
import { dayRange } from "@/lib/wb/domain/timeline";
import { eveningRound } from "@/lib/wb/evening";
import * as data from "@/lib/wb/forecast-data";
import { dutyRangeFrom, offFrom } from "@/lib/wb/input";
import { clashFor, recordView } from "@/lib/wb/records";
import { assign, closeRf, deploy, raiseRf, standDown, type NewAssignment } from "@/lib/wb/rf";
import * as rfData from "@/lib/wb/rf-data";
import { cardText } from "@/lib/wb/telegram/cards";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day, member, memberId, ok, reachable as dbUp } from "./writes";

let reachable = true;
const ids = { hq: "", pl6: "", pl7: "", slr: "", srfA: "", bdk: "", hdn: "" };
const people: Record<string, string[]> = {};

beforeAll(async () => {
  reachable = await dbUp();
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
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
  // no pattern: every camp stands every day, whatever day of the week day(1) is
  await db.delete(wbShiftEvent);
  await db.delete(wbShiftOverride);
  await db.delete(wbShiftPattern);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
beforeEach(async () => {
  if (reachable) await clean();
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

const v1Rows = async () => ({ duties: (await db.select({ id: duty.id }).from(duty)).length, absences: (await db.select({ id: absence.id }).from(absence)).length });
const stateOf = async () => (await db.select({ s: wbRfRequest.state }).from(wbRfRequest))[0].s;
const view = async (id: string) => (await rfData.rfView(id))!;

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
}
const range = (over: Record<string, string> = {}) => dutyRangeFrom({ startDate: day(1), startTime: "2100", endDate: day(2), endTime: "0900", ...over }, 31);
async function raise(c = recordingCourier(), over: { campId?: string; need?: number; range?: Record<string, string> } = {}) {
  return raiseRf(c, await acting(GC_SLR), { campId: over.campId ?? ids.slr, role: "ST CBT", need: over.need ?? 2, reason: "TWO ON MC", ...range(over.range) });
}
const raised = async (need = 2) => ok(await raise(recordingCourier(), { need })).request.id;
const sendsTo = (c: ReturnType<typeof recordingCourier>) => c.sent.flatMap((s) => ("send" in s ? [s] : []));

describe("raising an RF (DB)", () => {
  it("posts the request's card; it shows what's needed, and Deploy and Close", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const { request } = ok(await raise(c));
    expect(c.sent).toEqual([{ postCard: { rf: request.id } }]);
    expect(rfCardText(request)).toMatch(/^🚌 RF REQUEST\n\nCamp: SLR · PLATOON 6\nDuration: .+ 2100–.+ 0900\nManpower required: 2x ST CBT\nReason: TWO ON MC\n\n⏳ Still short 2 of 2\nraised by /);
    expect(rfButtons(request, false).flat().map((b) => b.text)).toEqual(["📌 Deploy someone", "❌ Close", "Open"]);
    expect(rfButtons(request, true).flat().map((b) => b.text)).toEqual(["❌ Close", "Open"]);
    expect(await db.select({ action: wbAudit.action, via: wbAudit.via }).from(wbAudit)).toEqual([{ action: "raise-rf", via: "MINIAPP" }]);
  });

  it("refuses a GC for another camp, and tells nobody", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(GC_SLR, people.SLR[0], [{ role: "GC", campId: ids.slr }]);
    const c = recordingCourier();
    expect(await raise(c, { campId: ids.srfA })).toEqual({ ok: false, error: "You can't ask for manpower for SRF A." });
    expect(c.sent).toEqual([]);
    expect(await db.select().from(wbRfRequest)).toEqual([]);
  });

  it("a GC grant without a camp asks for nothing (the user, 2026-10-21)", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(GC_SLR, people.SLR[0], [{ role: "GC" }]);
    const c = recordingCourier();
    expect(await raise(c, { campId: ids.slr })).toEqual({ ok: false, error: "You can't ask for manpower for SLR." });
    expect(c.sent).toEqual([]);
  });
});

describe("deploying (DB)", () => {
  it("sends the man: an assignment, the cards redrawn, he's told, his platoon is told with its manning, the raiser hears", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length });
    const before = await v1Rows();
    const c = recordingCourier();
    expect(await deploy(c, await acting(PS7), id, people.BDK[1])).toMatchObject({ ok: true, value: { request: { state: "OPEN" }, away: [] } });

    const [a] = await db.select().from(wbAssignment);
    expect(a).toMatchObject({ personId: people.BDK[1], type: "RF", campId: ids.slr, rfRequestId: id, state: "ACTIVE" });
    expect(c.sent.map((s) => ("send" in s ? { send: s.send } : s))).toEqual([{ redraw: { rf: id } }, { send: { person: people.BDK[1] } }, { send: { platoon: ids.pl7 } }, { send: { telegramId: GC_SLR } }]);
    expect(rfCardText(await view(id))).toMatch(/Manpower deployed: \S+ .+ \(BDK\)\n\n⏳ Still short 1 of 2/);
    const [toMan, toPl7, toRaiser] = sendsTo(c).map((s) => s.text);
    expect(toMan).toMatch(/^🚌 You've been sent on RF\n\nRF @ SLR .+\nAbsent from BDK, counted at SLR\.\n\nSent by T2007\. Report to SLR\.$/);
    expect(toPl7).toMatch(/^🚌 Sent on RF by T2007\n\n.+ \(BDK\)\nRF @ SLR [^]+\n\n⚠️ BDK on \d\d\/\d\d \(worst day\): 17 \/ min 18 — BELOW MINIMUM$/);
    expect(toRaiser).toMatch(/^✅ SLR is getting .+ \(BDK\)\n\n⏳ Still short 1 of 2$/);
    // nothing reached the parade state (projection is off)
    expect(await v1Rows()).toEqual(before);
  });

  it("fills on the last man: FILLED, buttons down to Open; the next is refused and nobody told", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised(1);
    expect(await deploy(recordingCourier(), await acting(PS7), id, people.BDK[1])).toMatchObject({ ok: true, value: { request: { state: "FILLED" } } });
    expect(await stateOf()).toBe("FILLED");
    expect(rfCardText(await view(id))).toContain("✅ FILLED");
    expect(rfButtons(await view(id), false).flat().map((b) => b.text)).toEqual(["Open"]);
    const c = recordingCourier();
    expect(await deploy(c, await acting(PS7), id, people.BDK[2])).toEqual({ ok: false, error: "Somebody got there first: that request is already filled." });
    expect(c.sent).toEqual([]);
  });

  it("the race for the last slot: exactly one of two commanders wins", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised(1);
    const results = await Promise.all([deploy(recordingCourier(), await acting(PS7), id, people.BDK[1]), deploy(recordingCourier(), await acting(OC, "BOT"), id, people.HDN[0])]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "Somebody got there first: that request is already filled." });
    expect(await db.select().from(wbAssignment)).toHaveLength(1);
    expect(await stateOf()).toBe("FILLED");
  });

  it("refuses the camp's own man, a man outside his scope, and a man already sent somewhere then; warns on leave", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised();
    const c = recordingCourier();
    expect(await deploy(c, await acting(GC_SLR), id, people.SLR[1])).toMatchObject({ ok: false, error: expect.stringMatching(/is SLR's own\. RF is served at another camp\./) });
    expect(await deploy(c, await acting(GC_SLR), id, people.BDK[1])).toMatchObject({ ok: false, error: expect.stringMatching(/he isn't in your platoon or camp/) });
    // already on Extra at HDN over the same night
    const extra: NewAssignment = { type: "EXTRA", campId: ids.hdn, personIds: [people.BDK[3]], note: "", ...dutyRangeFrom({ startDate: day(2), startTime: "0000", endDate: day(2), endTime: "2359" }, 31) };
    expect(await assign(recordingCourier(), await acting(OC), extra)).toMatchObject({ ok: true });
    expect(await deploy(c, await acting(OC), id, people.BDK[3])).toMatchObject({ ok: false, error: expect.stringMatching(/is already on Extra @ HDN/) });
    expect(c.sent).toEqual([]);
    // on leave: a warning, not a veto
    await db.insert(wbRecord).values({ personId: people.BDK[4], kind: "AL", startAt: dayRange(day(1)).startAt, endAt: dayRange(day(3)).startAt, absent: true, state: "APPROVED", createdVia: "SELF" });
    expect(await deploy(c, await acting(OC), id, people.BDK[4])).toMatchObject({ ok: true, value: { away: [expect.stringMatching(/^AL .+ · approved$/)] } });
  });

  it("the deploy list: everyone he may send, best first, with what losing each does to his camp", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length });
    const list = await rfData.candidatesFor(await view(id), (await acting(PS7)).actor.grants);
    expect(new Set(list.map((c) => c.subunitId))).toEqual(new Set([ids.pl7]));
    expect(list[0]).toMatchObject({ role: "ST CBT", refusal: null });
    expect(list.filter((c) => c.campId === ids.bdk).every((c) => /^BDK on .+ without him: 17 \/ min 18 — BELOW MINIMUM$/.test(c.manning ?? ""))).toBe(true);
  });

  it("the deploy list warns about an open v1 duty, as the DM after deploying does", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const r = await view(await raised());
    const man = people.BDK[2];
    const [p] = await db.select({ rank: person.rank, name: person.name }).from(person).where(eq(person.id, man));
    const [hdn] = await db.select({ coyId: camp.coyId }).from(camp).where(eq(camp.id, ids.hdn));
    const [d] = await db.insert(duty).values({ coyId: hdn.coyId, type: "EXTRA", rank: p.rank, name: p.name, personId: man, campId: ids.hdn, startDate: day(1), endDate: day(2), sortOrder: 99 }).returning({ id: duty.id });
    try {
      const him = (await rfData.candidatesFor(r, (await acting(PS7)).actor.grants)).find((c) => c.personId === man)!;
      expect(him.away).toContainEqual(expect.stringMatching(/^EXTRA @ HDN /));
      expect(him.away).toEqual(await clashFor(man, r));
    } finally {
      await db.delete(duty).where(eq(duty.id, d.id));
    }
  });
});

describe("closing and standing down (DB)", () => {
  it("the raiser closes; a second close and another platoon are refused and tell nobody; men sent stay sent", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised();
    await deploy(recordingCourier(), await acting(PS7), id, people.BDK[1]);
    const c = recordingCourier();
    expect(await closeRf(c, await acting(PS7, "BOT"), id)).toEqual({ ok: false, error: "Only whoever asked, or SLR's commanders, can close this." });
    expect(c.sent).toEqual([]);
    expect(await closeRf(c, await acting(GC_SLR), id)).toMatchObject({ ok: true, value: { deployed: [expect.anything()] } });
    expect(c.sent).toEqual([{ redraw: { rf: id } }]);
    expect(rfCardText(await view(id))).toMatch(/❌ CLOSED — no longer needed \(.+\)/);
    expect(await closeRf(c, await acting(GC_SLR), id)).toEqual({ ok: false, error: "It's already closed." });
    expect(c.sent).toHaveLength(1);
    expect(await db.select({ s: wbAssignment.state }).from(wbAssignment)).toEqual([{ s: "ACTIVE" }]);
  });

  it("standing a man down reopens a filled request and tells him and his platoon", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised(1);
    await deploy(recordingCourier(), await acting(PS7), id, people.BDK[1]);
    const [a] = await db.select().from(wbAssignment);
    const c = recordingCourier();
    // the camp that asked may release him too
    expect(await standDown(c, await acting(PS6), a.id)).toMatchObject({ ok: true });
    expect(await stateOf()).toBe("OPEN");
    expect(await db.select({ s: wbAssignment.state }).from(wbAssignment)).toEqual([{ s: "CANCELLED" }]);
    expect(c.sent).toEqual([
      { redraw: { rf: id } },
      { send: { person: people.BDK[1] }, text: expect.stringMatching(/^↩️ Stood down\n\nRF @ SLR /) },
      { send: { platoon: ids.pl7 }, text: expect.stringMatching(/^↩️ Stood down by T2006\n\n.+ \(BDK\)\nRF @ SLR .+\n\nBack with BDK\.$/) },
    ]);
    expect(rfCardText(await view(id))).toContain("⏳ Still short 1 of 1");
    expect(await standDown(c, await acting(PS6), a.id)).toEqual({ ok: false, error: "He's already been stood down." });
  });
});

describe("assign (DB)", () => {
  const sol = (personIds: string[], campId: string | null = null): NewAssignment => ({
    type: "SOL",
    campId,
    personIds,
    note: "",
    ...dutyRangeFrom({ startDate: day(1), startTime: "0000", endDate: day(5), endTime: "2359" }, 92),
  });

  it("Extra and SOL straight onto men: each told, one message per platoon, refusals named", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const c = recordingCourier();
    const by = await acting(PS7);
    const extra = (personIds: string[], d: number): NewAssignment => ({
      type: "EXTRA",
      campId: ids.bdk,
      personIds,
      note: "",
      ...dutyRangeFrom({ startDate: day(d), startTime: "0000", endDate: day(d), endTime: "2359" }, 31),
    });
    expect(await assign(c, by, extra([people.BDK[1]], 1))).toMatchObject({ ok: false, error: expect.stringMatching(/Extra can't be served at his own team \(BDK\)/) });
    expect(await assign(c, by, sol([people.SLR[1]]))).toMatchObject({ ok: false, error: expect.stringMatching(/he isn't in your platoon or camp/) });
    expect(c.sent).toEqual([]);
    expect(await assign(c, by, sol([people.BDK[1], people.BDK[2]], ids.slr))).toMatchObject({ ok: true, value: { ids: [expect.any(String), expect.any(String)] } });
    // SOL stands with his own camp, whatever camp was passed
    expect((await db.select({ c: wbAssignment.campId }).from(wbAssignment)).every((x) => x.c === ids.bdk)).toBe(true);
    expect(c.sent).toEqual([
      { send: { person: people.BDK[1] }, text: expect.stringMatching(/^⛔ You're on SOL\n\nSOL /) },
      { send: { person: people.BDK[2] }, text: expect.stringMatching(/^⛔ You're on SOL\n\nSOL /) },
      { send: { platoon: ids.pl7 }, text: expect.stringMatching(/^📌 SOL .+\nby T2007\n\n• .+ \(BDK\)\n• .+ \(BDK\)\n\nLeave stopped\. They stand with their own camp\.$/) },
    ]);
    // the same men again over the same days
    expect(await assign(c, by, { ...extra([people.BDK[2]], 3), campId: ids.hdn })).toMatchObject({ ok: false, error: expect.stringMatching(/is already on SOL @ BDK/) });
    // his leave application now shows the SOL in the clash check
    expect(await clashFor(people.BDK[1], dayRange(day(2)))).toEqual([expect.stringMatching(/^SOL @ BDK /)]);
  });
});

describe("assignments in the forecast and on cards (DB)", () => {
  it("an RF man counts at the camp that asked and is away from his own; an Off card in his platoon sees it", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await db.insert(wbMinManning).values({ campId: ids.bdk, total: people.BDK.length - 1 });
    const req = ok(await raise(recordingCourier(), { need: 1, range: { startDate: day(1), startTime: "0000", endDate: day(1), endTime: "2359" } })).request.id;
    const before = await data.grid([ids.slr, ids.bdk], day(1), 1);
    await deploy(recordingCourier(), await acting(PS7), req, people.BDK[1]);
    const after = await data.grid([ids.slr, ids.bdk], day(1), 1);
    const heads = (rows: typeof before, campId: string) => Number(rows.find((r) => r.campId === campId)!.cells[0].label);
    expect(heads(after, ids.slr)).toBe(heads(before, ids.slr) + 1);
    expect(heads(after, ids.bdk)).toBe(heads(before, ids.bdk) - 1);
    const dayView = await data.dayView([ids.bdk], day(1));
    expect(dayView[0].away).toEqual([expect.objectContaining({ personId: people.BDK[1], what: "OTHERS: RF @ SLR", assignmentId: expect.any(String) })]);

    // another BDK man asks for Off that day: his card's line counts the RF man out too
    await member(1002, people.BDK[2]);
    const off = { ...offFrom({ startDate: day(1), startTime: "0000", endDate: day(1), endTime: "2359" }), personId: people.BDK[2], memberId: await memberId(1002), createdVia: "SELF" as const };
    const [r] = ok(await submit(recordingCourier(), await acting(1002), [off])).records;
    const card = cardText(r, await data.manningFor((await recordView(r.id))!));
    expect(card).toContain(`⚠️ BDK on ${day(1).slice(8, 10)}/${day(1).slice(5, 7)}: ${people.BDK.length - 2} / min ${people.BDK.length - 1} — BELOW MINIMUM`);
  });

  it("the evening digest lists open requests for the camp's platoon and COY HQ", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await raise();
    const c = recordingCourier();
    const summary = await eveningRound(c, new Date(), { force: true });
    expect(summary.rf).toBe(1);
    const digest = (platoon: string) => sendsTo(c).find((s) => "platoon" in s.send && s.send.platoon === platoon && s.text.startsWith("🌙"))?.text ?? "";
    expect(digest(ids.pl6)).toMatch(/🚌 1 RF request still open\n• SLR .+: short 2 of 2/);
    expect(digest(ids.hq)).toMatch(/🚌 1 RF request still open, company-wide\n• SLR .+: short 2 of 2 \(PLATOON 6\)/);
    expect(digest(ids.pl7)).toBe("");
  });

  it("the evening round expires an open request whose shift has passed, and redraws its card (2026-10-14)", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const id = await raised();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await db.update(wbRfRequest).set({ startAt: new Date(past.getTime() - 12 * 60 * 60 * 1000), endAt: past }).where(eq(wbRfRequest.id, id));
    const c = recordingCourier();
    expect(await eveningRound(c, new Date(), { force: true })).toMatchObject({ rfExpired: 1, rf: 0 });
    expect(await stateOf()).toBe("EXPIRED");
    expect(c.sent).toContainEqual({ redraw: { rf: id } });
    expect(rfCardText(await view(id))).toContain("⌛ EXPIRED — the shift has passed, nobody was sent");
    expect(JSON.stringify(rfButtons(await view(id), false))).not.toMatch(/Deploy|Close/);
    expect(await db.select({ via: wbAudit.via, memberId: wbAudit.memberId }).from(wbAudit).where(eq(wbAudit.action, "expire-rf"))).toEqual([{ via: "SYSTEM", memberId: null }]);
    expect((await rfData.board()).settled.map((x) => x.id)).toContain(id);
    expect((await eveningRound(recordingCourier(), new Date(), { force: true })).rfExpired).toBe(0);
  });
});
