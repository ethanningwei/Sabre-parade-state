// Shifts through the database: saving a pattern and minimums, the HOTO
// (confirm vs re-anchor, the alert, v1 untouched), the manning line on an
// approval card, the forecast's scope and the evening digest's below-minimum
// lines. Telegram is faked. Uses sabre_test; skipped if unreachable.

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { sgtToInstant } from "@/lib/parade/time";
import { wbAudit, wbCard, wbCommanderChat, wbConversation, wbGrant, wbMember, wbMinManning, wbRecord, wbShiftEvent, wbShiftPattern } from "@/lib/wb/db/schema";
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
const actions = await import("@/lib/wb/actions/shifts");
const records = await import("@/lib/wb/actions/records");
const data = await import("@/lib/wb/forecast-data");
const { eveningRound } = await import("@/lib/wb/evening");

let reachable = true;
const ids = { pl5: "", pl6: "", slr: "", sftA: "", sftB: "", srfA: "", srfB: "" };
let chunHei: string;
let slrPeople: string[] = [];

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
  // SLR gets guardroom roles: the 12 present men are 1 GC, 5 CBT, 6 SVC, and
  // the five away on 30/09 are SVC. Two of those (MCs to 30/09) are back, so
  // from 01/10 SLR stands 1:5:8 (three Clementi men have no end date).
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

type Role = "PS" | "PC" | "GC" | "OC" | "ADMIN";
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
const day = (n: number) => addDays(todaySgt(), n);

const PS6 = 2001;
const GC_SFT_A = 3001;
const GC_SLR = 3002;
const TROOPER = 1001;

const weekly = (campIds: string[], minimums: Record<string, string> = {}) => ({
  campIds,
  kind: "WEEKLY" as const,
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
const sftCycle = (anchorDate: string, over: Record<string, unknown> = {}) => ({
  campIds: [ids.sftA, ids.sftB],
  kind: "CYCLE" as const,
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
    await as(1);
    expect(await actions.saveShiftPattern(sftCycle("2026-10-10"))).toEqual({ ok: true, data: { post: "SFT" } });
    const rows = await db.select().from(wbShiftPattern).where(inArray(wbShiftPattern.campId, [ids.sftA, ids.sftB]));
    expect(Object.fromEntries(rows.map((r) => [r.campId, r.anchorDate]))).toEqual({ [ids.sftB]: "2026-10-10", [ids.sftA]: "2026-10-13" });
    const mins = await db.select().from(wbMinManning);
    expect(mins.map((m) => [m.total, m.gc, m.stCbt, m.stSvc])).toEqual([
      [13, 1, 4, 8],
      [13, 1, 4, 8],
    ]);
    expect(await db.select({ a: wbAudit.action }).from(wbAudit)).toEqual([{ a: "shift-pattern" }]);

    // saving again replaces; an empty minimum removes it
    expect(await actions.saveShiftPattern(sftCycle("2026-10-13", { anchorCampId: ids.sftA, minimums: { [ids.sftA]: "12", [ids.sftB]: "" } }))).toMatchObject({ ok: true });
    const again = await db.select().from(wbShiftPattern).where(eq(wbShiftPattern.campId, ids.sftB));
    expect(again[0].anchorDate).toBe("2026-10-16");
    expect(await db.select({ c: wbMinManning.campId, t: wbMinManning.total, gc: wbMinManning.gc }).from(wbMinManning)).toEqual([{ c: ids.sftA, t: 12, gc: null }]);
  });

  it("refuses a half pair, a lopsided pair, a bad minimum, and another platoon", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
    await member(1, null, [{ role: "ADMIN" }]);
    await as(1);
    expect(await actions.saveShiftPattern({ ...sftCycle("2026-10-10"), campIds: [ids.sftA] })).toEqual({ ok: false, error: "Set both teams of a camp together." });
    expect(await actions.saveShiftPattern(sftCycle("2026-10-10", { offDays: 4 }))).toMatchObject({ ok: false, error: expect.stringMatching(/days on and off must match/) });
    expect(await actions.saveShiftPattern(sftCycle("2026-10-10", { minimums: { [ids.sftA]: "1:4" } }))).toMatchObject({ ok: false, error: expect.stringMatching(/^SFT A's minimum should look like 1:4:3/) });
    await as(PS6);
    expect(await actions.saveShiftPattern(sftCycle("2026-10-10"))).toEqual({ ok: false, error: "Only PLATOON 5's PC or PS can change its shifts." });
    expect(await actions.saveShiftPattern(weekly([ids.slr], { [ids.slr]: "1:4:3" }))).toMatchObject({ ok: true });
    expect(await db.select().from(wbShiftPattern)).toHaveLength(1);
  });
});

describe("HOTO (DB)", () => {
  async function sft() {
    await member(1, null, [{ role: "ADMIN" }]);
    await as(1);
    // B mounted 10/10 2100, so A is due 13/10 2100
    await actions.saveShiftPattern(sftCycle("2026-10-10"));
    await db.insert(wbCommanderChat).values({ subunitId: ids.pl5, chatId: -1005, threadId: 55, chatTitle: "PL5" });
    await member(GC_SFT_A, null, [{ role: "GC", campId: ids.sftA }]);
    await member(GC_SLR, null, [{ role: "GC", campId: ids.slr }]);
    tg.calls = [];
  }
  const vOnShift = async () => (await db.select({ n: camp.name, on: camp.onShift }).from(camp).where(inArray(camp.id, [ids.sftA, ids.sftB]))).sort((a, b) => a.n.localeCompare(b.n));

  it("on time confirms: logged, nothing moves, nobody is told, v1 untouched", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.useFakeTimers({ toFake: ["Date"], now: sgtToInstant({ date: "2026-10-13", time: "2200" }) });
    try {
      await sft();
      const before = await vOnShift();
      await as(GC_SFT_A);
      expect(await actions.recordHoto({ campId: ids.sftA, on: true, date: "2026-10-13", time: "2110" })).toEqual({ ok: true, data: { matched: true, alerted: false } });
      expect(await db.select({ on: wbShiftEvent.on, matched: wbShiftEvent.matched }).from(wbShiftEvent)).toEqual([{ on: true, matched: true }]);
      expect((await db.select().from(wbShiftPattern).where(eq(wbShiftPattern.campId, ids.sftA)))[0].anchorDate).toBe("2026-10-13");
      expect(sends()).toHaveLength(0);
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
      await as(GC_SFT_A);
      expect(await actions.recordHoto({ campId: ids.sftA, on: true, date: "2026-10-14", time: "2105" })).toEqual({ ok: true, data: { matched: false, alerted: true } });
      const anchors = Object.fromEntries((await db.select().from(wbShiftPattern)).map((r) => [r.campId, r.anchorDate]));
      expect(anchors).toEqual({ [ids.sftA]: "2026-10-14", [ids.sftB]: "2026-10-17" });
      const [alert] = sends();
      expect(alert.payload).toMatchObject({ chat_id: -1005, message_thread_id: 55 });
      expect(String(alert.payload.text)).toBe(
        "🔄 HOTO off the pattern · SFT\n\nSFT A took over at 14/10 2105 (logged by T3001).\nThe pattern expected it at 13/10 2100.\n\nThe cycle has moved: SFT A is on 14/10 2100–17/10 2100.",
      );
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
    await as(GC_SLR);
    expect(await actions.recordHoto({ campId: ids.sftA, on: true, date: todaySgt(), time: "0000" })).toEqual({ ok: false, error: "Only SFT's GC or PLATOON 5's PC or PS can log its HOTO." });
    await as(1);
    await actions.saveShiftPattern(weekly([ids.slr]));
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
    await as(PS6);
    expect(await actions.recordHoto({ campId: ids.slr, on: true, date: todaySgt(), time: "0000" })).toEqual({ ok: false, error: "SLR doesn't take turns, so there's no HOTO to log." });
    await as(GC_SFT_A);
    expect(await actions.recordHoto({ campId: ids.sftA, on: true, date: day(1), time: "2100" })).toEqual({ ok: false, error: "That's in the future. Log it when it happens." });
    expect(await db.select().from(wbShiftEvent)).toHaveLength(0);
  });
});

describe("manning on cards, the forecast and the digest (DB)", () => {
  /** SLR on every day, minimum 1:5:8 = exactly what it stands. */
  async function slr(minimum = "1:5:8") {
    await member(1, null, [{ role: "ADMIN" }]);
    await as(1);
    expect(await actions.saveShiftPattern(weekly([ids.slr], { [ids.slr]: minimum }))).toMatchObject({ ok: true });
    await member(PS6, chunHei, [{ role: "PS", subunitId: ids.pl6 }]);
    await db.insert(wbCommanderChat).values({ subunitId: ids.pl6, chatId: -1006, threadId: 66, chatTitle: "PL6" });
    tg.calls = [];
  }
  const apply = async (personTg: number, personId: string, start: number, end: number) => {
    await member(personTg, personId);
    await as(personTg);
    const res = await records.applyOff({ startDate: day(start), startTime: "0000", endDate: day(end), endTime: "2359" });
    if (!res.ok) throw new Error(res.error);
    return res.data.recordId;
  };

  it("the card says BELOW MINIMUM with the requester counted out, and is redrawn on decide", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    const gc = slrPeople[0];
    const id = await apply(TROOPER, gc, 3, 4);
    const card = String(sends()[0].payload.text);
    expect(card).toContain(`⚠️ SLR on ${day(3).slice(8, 10)}/${day(3).slice(5, 7)} (worst day): 0:5:8 / min 1:5:8 — BELOW MINIMUM`);
    tg.calls = [];
    await as(PS6);
    expect(await records.decideRecord({ recordId: id, action: "approve" })).toMatchObject({ ok: true });
    const edit = String(tg.calls.find((c) => c.method === "editMessageText")!.payload.text);
    expect(edit).toMatch(/0:5:8 \/ min 1:5:8 — BELOW MINIMUM\n\n✅ Approved by LCP CHUN HEI$/);
  });

  it("other pending requests are noted; no minimum and HQ wording", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr("1:4:8");
    await apply(1101, slrPeople[1], 5, 5);
    tg.calls = [];
    await apply(1102, slrPeople[2], 5, 5);
    expect(String(sends()[0].payload.text)).toContain(`👥 SLR on ${day(5).slice(8, 10)}/${day(5).slice(5, 7)}: 1:4:8 / min 1:4:8 (+1 pending would make it 1:3:8)`);

    await db.delete(wbMinManning);
    tg.calls = [];
    await apply(1103, slrPeople[3], 6, 6);
    expect(String(sends()[0].payload.text)).toContain("👥 No minimum manning set for SLR");
  });

  it("the forecast: a PS sees his platoon's guardrooms; the grid marks the short day", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    const [{ id: psId }] = await db.select({ id: wbMember.id }).from(wbMember).where(eq(wbMember.telegramUserId, PS6));
    const grants = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, psId));
    const scope = data.forecastScope(grants, await data.campsInfo());
    expect(scope.map((c) => c.name)).toEqual(["SLR", "SRF A", "SRF B"]);
    const id = await apply(TROOPER, slrPeople[0], 2, 2);
    await as(PS6);
    await records.decideRecord({ recordId: id, action: "approve" });
    const [row] = await data.grid([ids.slr], day(1), 3);
    expect(row.cells.map((c) => [c.date, c.short, c.label])).toEqual([
      [day(1), false, "1:5:8"],
      [day(2), true, "0:5:8"],
      [day(3), false, "1:5:8"],
    ]);
    const [slrDay] = await data.dayView([ids.slr], day(2));
    expect(slrDay.short).toBe(true);
    expect(slrDay.away.find((a) => a.personId === slrPeople[0])).toMatchObject({ what: "OFF", recordId: id, pending: false });
  });

  it("the evening digest lists camps below minimum tomorrow", async (ctx) => {
    if (!reachable) ctx.skip();
    await slr();
    const id = await apply(TROOPER, slrPeople[0], 1, 1);
    await as(PS6);
    await records.decideRecord({ recordId: id, action: "approve" });
    tg.calls = [];
    const { outbound } = await import("@/lib/wb/telegram/outbound");
    const summary = await eveningRound(await outbound(), new Date(), { force: true });
    expect(summary.short).toBe(1);
    const digest = sends().find((c) => c.payload.chat_id === -1006);
    expect(String(digest?.payload.text)).toContain("⚠️ Below minimum tomorrow\n• SLR: 0:5:8 / min 1:5:8");
  });
});

