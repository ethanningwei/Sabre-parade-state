// Shifts through the database, called as the Mini App calls the writes, with
// the recording Courier: saving a pattern and minimums, the HOTO (confirm vs
// re-anchor, the alert, v1 untouched), the manning line on an approval card,
// the forecast's scope and the evening digest's below-minimum lines. Uses
// sabre_test; skipped if unreachable.

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { sgtToInstant } from "@/lib/parade/time";
import { decide, submit } from "@/lib/wb/decide";
import { wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbMinManning, wbRecord, wbShiftEvent, wbShiftPattern } from "@/lib/wb/db/schema";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { eveningRound } from "@/lib/wb/evening";
import * as data from "@/lib/wb/forecast-data";
import { offFrom } from "@/lib/wb/input";
import { logHoto, saveShift, type ShiftInput } from "@/lib/wb/shifts";
import { cardText } from "@/lib/wb/telegram/cards";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day, member, ok, reachable as dbUp } from "./writes";

let reachable = true;
const ids = { pl5: "", pl6: "", slr: "", sftA: "", sftB: "", srfA: "", srfB: "" };
let chunHei: string;
let slrPeople: string[] = [];

beforeAll(async () => {
  reachable = await dbUp();
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const sub = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  ids.pl5 = await sub("PLATOON 5");
  ids.pl6 = await sub("PLATOON 6");
  ids.slr = await campId("SLR");
  ids.sftA = await campId("SFT A");
  ids.sftB = await campId("SFT B");
  ids.srfA = await campId("SRF A");
  ids.srfB = await campId("SRF B");
  const byName = async (name: string) => (await db.select({ id: person.id }).from(person).where(eq(person.name, name)))[0].id;
  chunHei = await byName("CHUN HEI");
  // SLR gets guardroom roles: 1 GC, 5 CBT, and the other 11 SVC. The forecast
  // ignores the parade state's own absences, so with nothing on the timeline
  // SLR stands 1:5:11.
  const slrRows = await db.select({ id: person.id, name: person.name }).from(person).where(eq(person.campId, ids.slr));
  slrPeople = slrRows.filter((p) => p.name.startsWith("SLR PRESENT")).map((p) => p.id);
  for (const p of slrRows) await db.update(person).set({ role: "SVC" }).where(eq(person.id, p.id));
  for (const [i, id] of slrPeople.entries()) await db.update(person).set({ role: i === 0 ? "GUARD COMM" : i <= 5 ? "CBT" : "SVC" }).where(eq(person.id, id));
});
async function clean() {
  await db.delete(wbConversation);
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbShiftEvent);
  await db.delete(wbShiftPattern);
  await db.delete(wbMinManning);
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

const PS6 = 2001;
const GC_SFT_A = 3001;
const GC_SLR = 3002;
const TROOPER = 1001;

const weekly = (campIds: string[], minimums: Record<string, string> = {}): ShiftInput => ({
  campIds,
  kind: "WEEKLY",
  onDays: 1,
  offDays: 0,
  anchorCampId: null,
  anchorDate: null,
  hotoTime: "0000",
  weekdayMask: 127,
  holidaysOff: false,
  bothOnAllowed: false,
  minimums,
});
const sftCycle = (anchorDate: string, over: Partial<ShiftInput> = {}): ShiftInput => ({
  campIds: [ids.sftA, ids.sftB],
  kind: "CYCLE",
  onDays: 3,
  offDays: 3,
  anchorCampId: ids.sftB,
  anchorDate,
  hotoTime: "2100",
  weekdayMask: 0,
  holidaysOff: false,
  bothOnAllowed: false,
  minimums: { [ids.sftA]: "1:4:8", [ids.sftB]: "1:4:8" },
  ...over,
});

describe("saving shifts (DB)", () => {
  it("a pair is set together: the other team follows, minimums per team, audited", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(1, null, [{ role: "ADMIN" }]);
    expect(await saveShift(await acting(1), sftCycle("2026-10-10"))).toEqual({ ok: true, value: { post: "SFT" } });
    const rows = await db.select().from(wbShiftPattern).where(inArray(wbShiftPattern.campId, [ids.sftA, ids.sftB]));
    expect(Object.fromEntries(rows.map((r) => [r.campId, r.anchorDate]))).toEqual({ [ids.sftB]: "2026-10-10", [ids.sftA]: "2026-10-13" });
    const mins = await db.select().from(wbMinManning);
    expect(mins.map((m) => [m.total, m.gc, m.stCbt, m.stSvc])).toEqual([
      [13, 1, 4, 8],
      [13, 1, 4, 8],
    ]);
    expect(await db.select({ a: wbAudit.action, via: wbAudit.via }).from(wbAudit)).toEqual([{ a: "shift-pattern", via: "MINIAPP" }]);

    // saving again replaces; an empty minimum removes it
    expect(await saveShift(await acting(1), sftCycle("2026-10-13", { anchorCampId: ids.sftA, minimums: { [ids.sftA]: "12", [ids.sftB]: "" } }))).toMatchObject({ ok: true });
    const again = await db.select().from(wbShiftPattern).where(eq(wbShiftPattern.campId, ids.sftB));
    expect(again[0].anchorDate).toBe("2026-10-16");
    expect(await db.select({ c: wbMinManning.campId, t: wbMinManning.total, gc: wbMinManning.gc }).from(wbMinManning)).toEqual([{ c: ids.sftA, t: 12, gc: null }]);
  });

  it("refuses a half pair, a lopsided pair, a bad minimum, and another platoon", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
    await member(1, null, [{ role: "ADMIN" }]);
    const admin = await acting(1);
    expect(await saveShift(admin, { ...sftCycle("2026-10-10"), campIds: [ids.sftA] })).toEqual({ ok: false, error: "Set both teams of a camp together." });
    expect(await saveShift(admin, sftCycle("2026-10-10", { offDays: 4 }))).toMatchObject({ ok: false, error: expect.stringMatching(/days on and off must match/) });
    expect(await saveShift(admin, sftCycle("2026-10-10", { minimums: { [ids.sftA]: "1:4" } }))).toMatchObject({ ok: false, error: expect.stringMatching(/^SFT A's minimum should look like 1:4:3/) });
    const ps = await acting(PS6);
    expect(await saveShift(ps, sftCycle("2026-10-10"))).toEqual({ ok: false, error: "Only PLATOON 5's PC or PS can change its shifts." });
    expect(await saveShift(ps, weekly([ids.slr], { [ids.slr]: "1:4:3" }))).toMatchObject({ ok: true });
    expect(await db.select().from(wbShiftPattern)).toHaveLength(1);
  });
});

describe("HOTO (DB)", () => {
  async function sft() {
    await member(1, null, [{ role: "ADMIN" }]);
    // B mounted 10/10 2100, so A is due 13/10 2100
    ok(await saveShift(await acting(1), sftCycle("2026-10-10")));
    await member(GC_SFT_A, null, [{ role: "GC", campId: ids.sftA }]);
    await member(GC_SLR, null, [{ role: "GC", campId: ids.slr }]);
  }
  const hoto = async (c: ReturnType<typeof recordingCourier>, tgId: number, campId: string, date: string, time: string) =>
    logHoto(c, await acting(tgId), { campId, on: true, at: sgtToInstant({ date, time }) });
  const vOnShift = async () => (await db.select({ n: camp.name, on: camp.onShift }).from(camp).where(inArray(camp.id, [ids.sftA, ids.sftB]))).sort((a, b) => a.n.localeCompare(b.n));

  it("on time confirms: logged, nothing moves, nobody is told, v1 untouched", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.useFakeTimers({ toFake: ["Date"], now: sgtToInstant({ date: "2026-10-13", time: "2200" }) });
    try {
      await sft();
      const before = await vOnShift();
      const c = recordingCourier();
      expect(await hoto(c, GC_SFT_A, ids.sftA, "2026-10-13", "2110")).toMatchObject({ ok: true, value: { matched: true, alert: null } });
      expect(await db.select({ on: wbShiftEvent.on, matched: wbShiftEvent.matched }).from(wbShiftEvent)).toEqual([{ on: true, matched: true }]);
      expect((await db.select().from(wbShiftPattern).where(eq(wbShiftPattern.campId, ids.sftA)))[0].anchorDate).toBe("2026-10-13");
      expect(c.sent).toEqual([]);
      expect(await vOnShift()).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a day late re-anchors both teams and tells the commanders chat", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.useFakeTimers({ toFake: ["Date"], now: sgtToInstant({ date: "2026-10-14", time: "2130" }) });
    try {
      await sft();
      const before = await vOnShift();
      const c = recordingCourier();
      expect(await hoto(c, GC_SFT_A, ids.sftA, "2026-10-14", "2105")).toMatchObject({ ok: true, value: { matched: false } });
      const anchors = Object.fromEntries((await db.select().from(wbShiftPattern)).map((r) => [r.campId, r.anchorDate]));
      expect(anchors).toEqual({ [ids.sftA]: "2026-10-14", [ids.sftB]: "2026-10-17" });
      expect(c.sent).toEqual([
        {
          send: { platoon: ids.pl5 },
          text: "🔄 HOTO off the pattern · SFT\n\nSFT A took over at 14/10 2105 (logged by T3001).\nThe pattern expected it at 13/10 2100.\n\nThe cycle has moved: SFT A is on 14/10 2100–17/10 2100.",
        },
      ]);
      expect(await db.select({ matched: wbShiftEvent.matched }).from(wbShiftEvent)).toEqual([{ matched: false }]);
      expect((await db.select({ a: wbAudit.action }).from(wbAudit)).map((a) => a.a)).toContain("hoto-reanchor");
      expect(await vOnShift()).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only the camp's GC, its platoon's PC/PS or company; never an RG camp; never the future", async (ctx) => {
    if (!reachable) ctx.skip();
    await sft();
    const c = recordingCourier();
    expect(await hoto(c, GC_SLR, ids.sftA, todaySgt(), "0000")).toEqual({ ok: false, error: "Only SFT's GC or PLATOON 5's PC or PS can log its HOTO." });
    await saveShift(await acting(1), weekly([ids.slr]));
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
    expect(await hoto(c, PS6, ids.slr, todaySgt(), "0000")).toEqual({ ok: false, error: "SLR doesn't take turns, so there's no HOTO to log." });
    expect(await hoto(c, GC_SFT_A, ids.sftA, day(1), "2100")).toEqual({ ok: false, error: "That's in the future. Log it when it happens." });
    expect(await db.select().from(wbShiftEvent)).toHaveLength(0);
    expect(c.sent).toEqual([]);
  });
});

describe("manning on cards, the forecast and the digest (DB)", () => {
  /** SLR on every day, minimum 1:5:11 = exactly what it stands. */
  async function slr(minimum = "1:5:11") {
    await member(1, null, [{ role: "ADMIN" }]);
    expect(await saveShift(await acting(1), weekly([ids.slr], { [ids.slr]: minimum }))).toMatchObject({ ok: true });
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
  }
  /** He applies for Off; returns the record and its card's text as the Courier would draw it. */
  const apply = async (personTg: number, personId: string, start: number, end: number) => {
    const m = await member(personTg, personId);
    const off = { ...offFrom({ startDate: day(start), startTime: "0000", endDate: day(end), endTime: "2359" }), personId, memberId: m.id, createdVia: "SELF" as const };
    const [r] = ok(await submit(recordingCourier(), await acting(personTg), [off])).records;
    return { id: r.id, card: cardText(r, await data.manningFor(r)) };
  };
  const approve = async (id: string) => ok(await decide(recordingCourier(), await acting(PS6), id, "approve"));

  it("the card says BELOW MINIMUM with the requester counted out, and is redrawn on decide", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    const gc = slrPeople[0];
    const { id, card } = await apply(TROOPER, gc, 3, 4);
    expect(card).toContain(`⚠️ SLR on ${day(3).slice(8, 10)}/${day(3).slice(5, 7)} (worst day): 0:5:11 / min 1:5:11 — BELOW MINIMUM`);
    const after = await approve(id);
    expect(cardText(after, await data.manningFor(after))).toMatch(/0:5:11 \/ min 1:5:11 — BELOW MINIMUM\n\n✅ Approved by LCP CHUN HEI$/);
  });

  it("other pending requests are noted; no minimum and HQ wording", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr("1:4:11");
    await apply(1101, slrPeople[1], 5, 5);
    expect((await apply(1102, slrPeople[2], 5, 5)).card).toContain(`👥 SLR on ${day(5).slice(8, 10)}/${day(5).slice(5, 7)}: 1:4:11 / min 1:4:11 (+1 pending would make it 1:3:11)`);

    await db.delete(wbMinManning);
    expect((await apply(1103, slrPeople[3], 6, 6)).card).toContain("👥 No minimum manning set for SLR");
  });

  it("the forecast: a PS sees his platoon's guardrooms; the grid marks the short day", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    const scope = data.forecastScope((await acting(PS6)).actor.grants, await data.campsInfo());
    expect(scope.map((c) => c.name)).toEqual(["SLR", "SRF A", "SRF B"]);
    const { id } = await apply(TROOPER, slrPeople[0], 2, 2);
    await approve(id);
    const [row] = await data.grid([ids.slr], day(1), 3);
    expect(row.cells.map((c) => [c.date, c.short, c.label])).toEqual([
      [day(1), false, "1:5:11"],
      [day(2), true, "0:5:11"],
      [day(3), false, "1:5:11"],
    ]);
    const [slrDay] = await data.dayView([ids.slr], day(2));
    expect(slrDay.short).toBe(true);
    expect(slrDay.away.find((a) => a.personId === slrPeople[0])).toMatchObject({ what: "OFF", recordId: id, pending: false });
  });

  it("the evening digest lists camps below minimum tomorrow", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    await approve((await apply(TROOPER, slrPeople[0], 1, 1)).id);
    const c = recordingCourier();
    const summary = await eveningRound(c, new Date(), { force: true });
    expect(summary.short).toBe(1);
    const digest = c.sent.find((s) => "send" in s && "platoon" in s.send && s.send.platoon === ids.pl6);
    expect(digest && "text" in digest ? digest.text : "").toContain("⚠️ Below minimum tomorrow\n• SLR: 0:5:11 / min 1:5:11");
  });
});

