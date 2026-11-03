// Conducts through the database (slices 2 and 3 of docs/conducts-plan.md),
// called as the Mini App calls the writes, with the recording Courier: set-up
// and its DMs, a camp's send (rebuilt on the server, posted, then edited), who
// may send, the day and cancel refusals, nudge's gap, cancel's DMs, and
// linking Commanders of N23. Named lists: the template posted at set-up, each
// camp's names editing that one post, NIL, the away warnings, the day,
// Needs you. Then the Courier's own post and edit over a fake Telegram. Uses
// sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { Api } from "grammy";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, coy, person } from "@/lib/db/schema";
import { linkCoyChat } from "@/lib/wb/admin";
import { openReportsFor } from "@/lib/wb/conduct-data";
import { cancelConduct, nudgeConductCamp, reportConductStrength, reportNames, setUpConduct } from "@/lib/wb/conducts";
import { wbAudit, wbConduct, wbConductCamp, wbConductMan, wbCoyChat, wbGrant, wbMember, wbPhase, wbRecord } from "@/lib/wb/db/schema";
import { dayRange } from "@/lib/wb/domain/timeline";
import { strengthOn } from "@/lib/wb/strength-data";
import { courierOf } from "@/lib/wb/telegram/courier";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day, member, ok, reachable as dbUp } from "./writes";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

let reachable = true;
const ids = { coy: "", pl5: "", pl6: "", slr: "", tft: "", sftA: "", hq: "" };
let slrMen: string[] = [];

const PS6 = 2001;
const GC_SLR = 3002;
const GC_TFT = 3003;
const OC = 4001;
const TROOPER = 1001;

beforeAll(async () => {
  reachable = await dbUp();
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const campRow = async (name: string) => (await db.select({ id: camp.id, subunitId: camp.subunitId }).from(camp).where(eq(camp.name, name)))[0];
  ids.coy = (await db.select({ id: coy.id }).from(coy))[0].id;
  const slr = await campRow("SLR");
  const tft = await campRow("TFT");
  ids.slr = slr.id;
  ids.pl6 = slr.subunitId;
  ids.tft = tft.id;
  ids.pl5 = tft.subunitId;
  ids.sftA = (await campRow("SFT A")).id;
  ids.hq = (await campRow("COY HQ")).id;
  slrMen = (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, ids.slr), eq(person.active, true))).orderBy(person.sortOrder)).map((p) => p.id);
});
async function clean() {
  await db.delete(wbRecord);
  await db.delete(wbConductMan);
  await db.delete(wbConductCamp);
  await db.delete(wbConduct);
  await db.delete(wbCoyChat);
  await db.delete(wbPhase);
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
beforeEach(async () => {
  if (!reachable) return;
  await clean();
  await member(PS6, null, [{ role: "PS", subunitId: ids.pl6 }]);
  await member(GC_SLR, null, [{ role: "GC", campId: ids.slr }]);
  await member(GC_TFT, null, [{ role: "GC", campId: ids.tft }]);
  await member(OC, null, [{ role: "OC" }]);
  await member(TROOPER, slrMen[3]);
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

const input = (campIds: string[], date = day(0)) => ({ kind: "STRENGTH" as const, title: "CPT PARTICIPATING STRENGTH", date, reportBy: "1830", campIds, team: null, dueDate: null });
const namedInput = (campIds: string[], date = day(2)) => ({
  kind: "NAMED" as const,
  title: "OSE & COMD TRAINING",
  date,
  reportBy: "1800",
  campIds,
  team: "A" as const,
  dueDate: date > day(0) ? day(1) : date,
});
const campRowOf = async (conductId: string, campId: string) =>
  (await db.select().from(wbConductCamp).where(and(eq(wbConductCamp.conductId, conductId), eq(wbConductCamp.campId, campId))))[0];

async function setUp(campIds: string[], date = day(0)) {
  const courier = recordingCourier();
  const v = ok(await setUpConduct(courier, await acting(PS6), input(campIds, date)));
  return { ...v, courier };
}

describe("setting up a conduct", () => {
  it("saves it, DMs each ticked camp's GC with a Send button, and names the camps with nobody to ask", async () => {
    if (!reachable) return;
    const { id, noGc, courier } = await setUp([ids.slr, ids.tft, ids.sftA]);
    expect(noGc).toEqual(["SFT A"]);
    const dms = courier.sent.flatMap((s) => ("send" in s ? [s] : []));
    // in parade-state order: PLATOON 5's TFT, then PLATOON 6's SLR
    expect(dms.map((d) => d.send)).toEqual([{ telegramId: GC_TFT }, { telegramId: GC_SLR }]);
    const slr = await campRowOf(id, ids.slr);
    expect(dms[1].text).toContain("SLR's strength");
    expect(dms[1].buttons).toEqual([[{ text: "Send SLR's strength", route: `conducts/camp/${slr.id}` }]]);
    expect(await db.select().from(wbAudit).where(eq(wbAudit.action, "conduct-setup"))).toHaveLength(1);
  });

  it("refuses a GC or trooper, COY HQ, and ROT", async () => {
    if (!reachable) return;
    const c = recordingCourier();
    for (const tg of [GC_SLR, TROOPER]) expect(await setUpConduct(c, await acting(tg), input([ids.slr]))).toEqual({ ok: false, error: expect.stringContaining("PS or above") });
    expect(await setUpConduct(c, await acting(PS6), input([ids.hq]))).toEqual({ ok: false, error: expect.stringContaining("isn't a guardroom") });
    await db.insert(wbPhase).values({ coyId: ids.coy, phase: "ROT" });
    expect(await setUpConduct(c, await acting(OC), input([ids.slr]))).toEqual({ ok: false, error: expect.stringContaining("Vigilance only") });
    expect(c.sent).toEqual([]);
    expect(await db.select().from(wbConduct)).toEqual([]);
  });
});

describe("sending a camp's strength", () => {
  it("rebuilds the men on the server, keeps only the sender's taps, and posts it", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr]);
    const row = await campRowOf(id, ids.slr);
    const courier = recordingCourier();
    const stranger = "6f1c1a52-0000-4000-8000-000000000000";
    const v = ok(
      await reportConductStrength(courier, await acting(GC_SLR), {
        conductCampId: row.id,
        taps: { [slrMen[0]]: { going: false, reason: "driving" }, [stranger]: { going: false, reason: "MC" } },
      }),
    );
    expect(v).toMatchObject({ delivery: "sent", again: false });
    expect(courier.sent).toEqual([{ post: { coyId: ids.coy, kind: "COMMANDERS" }, text: v.text }]);
    expect(v.text).toContain("(DRIVING)");
    const men = await db.select().from(wbConductMan).where(eq(wbConductMan.conductCampId, row.id));
    expect(men).toHaveLength(slrMen.length);
    expect(men.find((m) => m.personId === slrMen[0])).toMatchObject({ going: false, reason: "DRIVING", source: "tap" });
    expect(men.some((m) => m.personId === stranger)).toBe(false);
    const after = await campRowOf(id, ids.slr);
    expect(after).toMatchObject({ chatId: -1, messageId: 1, total: slrMen.length, going: men.filter((m) => m.going).length });
    expect(after.reportedAt).not.toBeNull();
  });

  it("a second send edits the first post, saying when", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr]);
    const row = await campRowOf(id, ids.slr);
    ok(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: row.id, taps: {} }));
    const courier = recordingCourier();
    const v = ok(await reportConductStrength(courier, await acting(GC_SLR), { conductCampId: row.id, taps: { [slrMen[1]]: { going: false, reason: "MOUNTING" } } }));
    expect(v.again).toBe(true);
    expect(courier.sent).toEqual([{ editPost: { chatId: -1, threadId: null, messageId: 1 }, text: expect.stringMatching(/\(MOUNTING\)[\s\S]*\n\nUpdated \d{4}H$/) }]);
  });

  it("with Commanders of N23 not linked, it's saved and says so", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr]);
    const row = await campRowOf(id, ids.slr);
    const v = ok(await reportConductStrength(courierOf(null), await acting(GC_SLR), { conductCampId: row.id, taps: {} }));
    expect(v.delivery).toBe("no-chat");
    const after = await campRowOf(id, ids.slr);
    expect(after.reportedAt).not.toBeNull();
    expect(after.messageId).toBeNull();
  });

  it("its GC or anyone above him; not another camp's GC", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr]);
    const row = await campRowOf(id, ids.slr);
    const send = async (tg: number) => reportConductStrength(recordingCourier(), await acting(tg), { conductCampId: row.id, taps: {} });
    expect(await send(GC_TFT)).toEqual({ ok: false, error: "Only SLR's GC, or a commander above him, can send its strength." });
    expect(await send(TROOPER)).toMatchObject({ ok: false });
    expect((await send(PS6)).ok).toBe(true);
    expect((await send(OC)).ok).toBe(true);
  });

  it("only on the day, and not once cancelled", async () => {
    if (!reachable) return;
    const tomorrow = await setUp([ids.slr], day(1));
    const t = await campRowOf(tomorrow.id, ids.slr);
    expect(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: t.id, taps: {} })).toEqual({
      ok: false,
      error: expect.stringContaining("sent on the day"),
    });
    const today = await setUp([ids.slr]);
    ok(await cancelConduct(recordingCourier(), await acting(PS6), today.id));
    const r = await campRowOf(today.id, ids.slr);
    expect(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: r.id, taps: {} })).toEqual({ ok: false, error: "This conduct was cancelled." });
  });
});

describe("nudge and cancel", () => {
  it("nudges a waiting camp's GC, once every 10 minutes, and never one that has sent", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr, ids.tft]);
    const slr = await campRowOf(id, ids.slr);
    const now = new Date();
    const c = recordingCourier();
    expect(ok(await nudgeConductCamp(c, await acting(PS6), slr.id, now))).toEqual({ asked: 1, sent: 1 });
    expect(c.sent).toEqual([{ send: { telegramId: GC_SLR }, text: expect.stringMatching(/^⏰ Still waiting for SLR's strength/), buttons: [[{ text: "Send SLR's strength", route: `conducts/camp/${slr.id}` }]] }]);
    expect(await nudgeConductCamp(c, await acting(PS6), slr.id, new Date(now.getTime() + 5 * 60_000))).toEqual({ ok: false, error: expect.stringContaining("last 10 minutes") });
    expect((await nudgeConductCamp(c, await acting(PS6), slr.id, new Date(now.getTime() + 11 * 60_000))).ok).toBe(true);
    expect(await nudgeConductCamp(c, await acting(GC_TFT), slr.id)).toMatchObject({ ok: false });
    ok(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: slr.id, taps: {} }));
    expect(await nudgeConductCamp(c, await acting(PS6), slr.id, new Date(now.getTime() + 30 * 60_000))).toEqual({ ok: false, error: "That camp has sent its strength." });
  });

  it("cancelling tells only the GCs who haven't sent", async () => {
    if (!reachable) return;
    const { id } = await setUp([ids.slr, ids.tft]);
    ok(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: (await campRowOf(id, ids.slr)).id, taps: {} }));
    const c = recordingCourier();
    expect(ok(await cancelConduct(c, await acting(OC), id))).toBe(1);
    expect(c.sent).toEqual([{ send: { telegramId: GC_TFT }, text: expect.stringContaining("is cancelled") }]);
    expect((await db.select().from(wbConduct).where(eq(wbConduct.id, id)))[0].state).toBe("CANCELLED");
    expect(await cancelConduct(recordingCourier(), await acting(GC_SLR), id)).toMatchObject({ ok: false });
  });
});

async function setUpNamed(campIds: string[], date = day(2), courier = recordingCourier()) {
  const v = ok(await setUpConduct(courier, await acting(PS6), namedInput(campIds, date)));
  return { ...v, courier };
}
const conductRow = async (id: string) => (await db.select().from(wbConduct).where(eq(wbConduct.id, id)))[0];
const names = (courier: ReturnType<typeof recordingCourier>, tg: number, conductCampId: string, personIds: string[], now?: Date) =>
  acting(tg).then((by) => reportNames(courier, by, { conductCampId, personIds }, now));

describe("a named list", () => {
  it("set-up posts the empty coy list and DMs each GC to name his men", async () => {
    if (!reachable) return;
    const { id, courier, delivery } = await setUpNamed([ids.slr, ids.tft]);
    expect(delivery).toBe("sent");
    const slr = await campRowOf(id, ids.slr);
    const post = courier.sent.find((x) => "post" in x);
    expect(post).toEqual({ post: { coyId: ids.coy, kind: "COMMANDERS" }, text: expect.stringContaining("OSE & COMD TRAINING\n(Team A)\n\nParticipants") });
    expect(post && post.text).toMatch(/Plt 5:\n\nTFT:\n\nPlt 6:\n\nSLR:$/);
    const dm = courier.sent.find((x) => "send" in x && "telegramId" in x.send && x.send.telegramId === GC_SLR);
    expect(dm).toMatchObject({ text: expect.stringMatching(/^📋 Name SLR's men for \d{6} OSE & COMD TRAINING \(Team A\), by \d{6} 1800H/), buttons: [[{ text: "Name SLR's men", route: `conducts/camp/${slr.id}` }]] });
    expect(await conductRow(id)).toMatchObject({ kind: "NAMED", team: "A", dueDate: day(1), chatId: -1, messageId: 1 });
  });

  it("a camp's names: only its own men, away ones kept with Sabre's warning, and the one post edited", async () => {
    if (!reachable) return;
    const { id } = await setUpNamed([ids.slr, ids.tft]);
    const leave = dayRange(day(2));
    await db.insert(wbRecord).values({ personId: slrMen[6], kind: "AL", startAt: leave.startAt, endAt: leave.endAt, absent: true, state: "APPROVED", createdVia: "SELF" });
    const slr = await campRowOf(id, ids.slr);
    const stranger = "6f1c1a52-0000-4000-8000-000000000000";
    const courier = recordingCourier();
    const v = ok(await names(courier, GC_SLR, slr.id, [slrMen[6], slrMen[5], stranger]));
    expect(v).toMatchObject({ delivery: "sent", again: false });
    expect(courier.sent).toEqual([{ editPost: { chatId: -1, threadId: null, messageId: 1 }, text: expect.stringMatching(/\nSLR:\nPTE SLR PRESENT 1\nPTE SLR PRESENT 2\n\nUpdated \d{4}H$/) }]);
    expect(v.text).toContain("Total Strength: 2\n");
    expect(v.text).toContain("Plt 6: 2\n");
    const men = await db.select().from(wbConductMan).where(eq(wbConductMan.conductCampId, slr.id));
    expect(men.map((m) => [m.personId, m.going, m.source])).toEqual([
      [slrMen[5], true, null],
      [slrMen[6], true, "auto"],
    ]);
    expect(men[1].reason).toMatch(/^AL /);
    expect(await campRowOf(id, ids.slr)).toMatchObject({ going: 2, total: slrMen.length });
    expect(await db.select().from(wbAudit).where(eq(wbAudit.action, "conduct-names"))).toHaveLength(1);
  });

  it("a second camp edits the same post with both; nobody is NIL; sending again says so", async () => {
    if (!reachable) return;
    const { id } = await setUpNamed([ids.slr, ids.tft]);
    const slr = await campRowOf(id, ids.slr);
    const tft = await campRowOf(id, ids.tft);
    ok(await names(recordingCourier(), GC_SLR, slr.id, [slrMen[5]]));
    const c = recordingCourier();
    const v = ok(await names(c, GC_TFT, tft.id, []));
    expect(v.text).toMatch(/Plt 5: 0\n\nTFT:\nNIL\n\nPlt 6: 1\n\nSLR:\nPTE SLR PRESENT 1$/);
    expect(c.sent).toEqual([{ editPost: { chatId: -1, threadId: null, messageId: 1 }, text: expect.stringContaining("TFT:\nNIL") }]);
    expect(ok(await names(recordingCourier(), GC_SLR, slr.id, [])).again).toBe(true);
    expect((await conductRow(id)).text).toContain("SLR:\nNIL");
  });

  it("with no chat at set-up, the first send posts it and the next edits that", async () => {
    if (!reachable) return;
    const { id, delivery } = await setUpNamed([ids.slr], day(2), courierOf(null) as ReturnType<typeof recordingCourier>);
    expect(delivery).toBe("no-chat");
    const slr = await campRowOf(id, ids.slr);
    const c = recordingCourier();
    ok(await names(c, GC_SLR, slr.id, [slrMen[5]]));
    expect(c.sent).toEqual([{ post: { coyId: ids.coy, kind: "COMMANDERS" }, text: expect.stringMatching(/SLR:\nPTE SLR PRESENT 1$/) }]);
    expect(await conductRow(id)).toMatchObject({ chatId: -1, messageId: 1 });
  });

  it("before the day and on it; not after, not once cancelled, not another camp's GC, not a strength", async () => {
    if (!reachable) return;
    const { id } = await setUpNamed([ids.slr]);
    const slr = await campRowOf(id, ids.slr);
    expect(await names(recordingCourier(), GC_TFT, slr.id, [])).toEqual({ ok: false, error: "Only SLR's GC, or a commander above him, can name its men." });
    expect((await names(recordingCourier(), PS6, slr.id, [])).ok).toBe(true);
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect(await names(recordingCourier(), GC_SLR, slr.id, [], later)).toEqual({ ok: false, error: expect.stringContaining("Names can't be changed now") });
    ok(await cancelConduct(recordingCourier(), await acting(PS6), id));
    expect(await names(recordingCourier(), GC_SLR, slr.id, [])).toEqual({ ok: false, error: "This conduct was cancelled." });
    const strength = await setUp([ids.slr]);
    const s = await campRowOf(strength.id, ids.slr);
    expect(await names(recordingCourier(), GC_SLR, s.id, [])).toMatchObject({ ok: false });
    expect(await reportConductStrength(recordingCourier(), await acting(GC_SLR), { conductCampId: slr.id, taps: {} })).toMatchObject({ ok: false });
  });

  it("nudge says names; cancel tells the waiting GCs and marks the post", async () => {
    if (!reachable) return;
    const { id } = await setUpNamed([ids.slr, ids.tft]);
    const slr = await campRowOf(id, ids.slr);
    const c = recordingCourier();
    ok(await nudgeConductCamp(c, await acting(PS6), slr.id));
    expect(c.sent).toEqual([{ send: { telegramId: GC_SLR }, text: expect.stringMatching(/^⏰ Still waiting for SLR's men/), buttons: [[{ text: "Name SLR's men", route: `conducts/camp/${slr.id}` }]] }]);
    ok(await names(recordingCourier(), GC_SLR, slr.id, [slrMen[5]]));
    expect(await nudgeConductCamp(c, await acting(PS6), slr.id, new Date(Date.now() + 11 * 60_000))).toEqual({ ok: false, error: "That camp has named its men." });
    const x = recordingCourier();
    expect(ok(await cancelConduct(x, await acting(OC), id))).toBe(1);
    expect(x.sent).toEqual([
      { send: { telegramId: GC_TFT }, text: expect.stringContaining("No need to name anyone.") },
      { editPost: { chatId: -1, threadId: null, messageId: 1 }, text: expect.stringMatching(/SLR:\nPTE SLR PRESENT 1\n\n❌ Cancelled \d{4}H$/) },
    ]);
  });

  it("Needs you asks the GC from set-up until he names his men", async () => {
    if (!reachable) return;
    const { id } = await setUpNamed([ids.slr]);
    const gc = { grants: [{ role: "GC" as const, subunitId: null, campId: ids.slr, coyId: null }] };
    expect(await openReportsFor(gc, day(0))).toMatchObject([{ campName: "SLR", kind: "NAMED", date: day(2), dueDate: day(1), reportBy: "1800" }]);
    ok(await names(recordingCourier(), GC_SLR, (await campRowOf(id, ids.slr)).id, []));
    expect(await openReportsFor(gc, day(0))).toEqual([]);
  });

  it("strengthOn warns of anything touching the day, a pending request too", async () => {
    if (!reachable) return;
    const d = dayRange(day(2));
    const tomorrowOn = dayRange(day(1));
    await db.insert(wbRecord).values([
      { personId: slrMen[6], kind: "AL", startAt: tomorrowOn.startAt, endAt: new Date(d.startAt.getTime() + 3_600_000), absent: true, state: "APPROVED", createdVia: "SELF" },
      { personId: slrMen[7], kind: "OFF", startAt: d.startAt, endAt: d.endAt, absent: true, state: "PENDING", createdVia: "SELF" },
      { personId: slrMen[8], kind: "OFF", startAt: tomorrowOn.startAt, endAt: tomorrowOn.endAt, absent: true, state: "APPROVED", createdVia: "SELF" },
    ]);
    const found = await strengthOn(ids.slr, day(2));
    const away = (i: number) => found!.men.find((m) => m.personId === slrMen[i])!.away;
    expect(away(6)).toMatch(/^AL /);
    expect(away(7)).toMatch(/^OFF .* pending$/);
    expect(away(8)).toBeNull();
    // the parade state's undated entry touches every day
    expect(away(0)).not.toBeNull();
  });
});

describe("Commanders of N23", () => {
  const link = { kind: "COMMANDERS" as const, chatId: -1023, threadId: 7, chatTitle: "Commanders of N23" };

  it("an OC (or an ASA, or ADMIN) links it with /here COMMANDERS; a GC or PS can't", async () => {
    if (!reachable) return;
    for (const tg of [GC_SLR, PS6]) expect(await linkCoyChat(await acting(tg, "BOT"), link)).toMatchObject({ ok: false });
    expect(ok(await linkCoyChat(await acting(OC, "BOT"), link))).toEqual({ replaced: null });
    expect(ok(await linkCoyChat(await acting(OC, "BOT"), link))).toBe("same");
    const moved = ok(await linkCoyChat(await acting(OC, "BOT"), { ...link, threadId: null }));
    expect(moved).toMatchObject({ replaced: { chatId: -1023, threadId: 7 } });
    expect(await db.select().from(wbCoyChat)).toHaveLength(1);
  });

  it("the Courier posts into its topic, and edits that post", async () => {
    if (!reachable) return;
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const api = new Api("123:TEST");
    api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: true, result: { message_id: 55, date: 0, chat: { id: -1023, type: "supergroup" } } } as any;
    });
    const courier = courierOf({ api, botUsername: "sabrecoybot" });
    expect(await courier.post({ coyId: ids.coy, kind: "COMMANDERS" }, "x")).toEqual({ delivery: "no-chat", ref: null });
    ok(await linkCoyChat(await acting(OC, "BOT"), link));
    const { delivery, ref } = await courier.post({ coyId: ids.coy, kind: "COMMANDERS" }, "021126 CPT");
    expect(delivery).toBe("sent");
    expect(ref).toEqual({ chatId: -1023, threadId: 7, messageId: 55 });
    expect(await courier.editPost(ref!, "021126 CPT\n\nUpdated 1931H")).toBe(true);
    expect(calls.map((c) => [c.method, c.payload.chat_id, c.payload.message_thread_id ?? c.payload.message_id])).toEqual([
      ["sendMessage", -1023, 7],
      ["editMessageText", -1023, 55],
    ]);
  });
});
