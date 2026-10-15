// Transport claims through the database: submit (one row per day, onto the
// OC's sheet with his columns untouched), the sheet not set or failing (saved,
// sent at the evening round), reading his verdicts back wherever his script
// moved the row (approved, rejected with remarks, deleted), the trooper's DM
// once, COY HQ's digest line, and nothing at all with FEATURE_CLAIMS off. The
// sheet is in memory; Telegram is faked. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbClaim, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { CLAIM_HEADERS } from "@/lib/wb/domain/claims";
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

// the OC's sheet, in memory; null = not configured
const sheetState = vi.hoisted(() => ({ tabs: null as Record<string, string[][]> | null, fail: false }));
vi.mock("@/lib/wb/sheets", async (orig) => {
  const real = await orig<typeof import("@/lib/wb/sheets")>();
  return {
    ...real,
    claimSheet: () => {
      if (!sheetState.tabs) return null;
      const mem = real.memorySheet(sheetState.tabs);
      const backend = {
        ...mem,
        write: async (u: Parameters<typeof mem.write>[0]) => {
          if (sheetState.fail) throw new Error("Google Sheets 503");
          return mem.write(u);
        },
      };
      return new real.ClaimSheet(backend, "Pending Requests");
    },
    claimSheetUrl: () => "https://sheet.example",
  };
});

const { signIn } = await import("@/lib/wb/auth");
const actions = await import("@/lib/wb/actions/claims");
const claims = await import("@/lib/wb/claims");
const { eveningRound } = await import("@/lib/wb/evening");
const { courier } = await import("@/lib/wb/telegram/courier");
const { ClaimSheet, memorySheet } = await import("@/lib/wb/sheets");

let reachable = true;
const ids = { hq: "", bdk: "", srfA: "", man: "", srfMan: "" };

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("FEATURE_CLAIMS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  vi.stubEnv("WB_APP_URL", "https://sabre.example");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  ids.hq = (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.isHq, true)))[0].id;
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  ids.bdk = await campId("BDK");
  ids.srfA = await campId("SRF A");
  const first = async (c: string) => (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, c), eq(person.active, true))).orderBy(person.sortOrder))[0].id;
  ids.man = await first(ids.bdk);
  ids.srfMan = await first(ids.srfA);
});
async function clean() {
  await db.delete(wbClaim);
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
const fresh = () => ({ "Pending Requests": [[...CLAIM_HEADERS]], "Processed Requests": [[...CLAIM_HEADERS]] });
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  tg.calls = [];
  sheetState.tabs = fresh();
  sheetState.fail = false;
  vi.stubEnv("FEATURE_CLAIMS", "1");
  await clean();
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

const MAN = 1001;
const SRF = 1002;
async function setup() {
  await db.insert(wbMember).values([
    { telegramUserId: MAN, tgName: "Man", personId: ids.man, fullName: "TAN AH KOW BIN ABDULLAH", registeredAt: new Date(), source: "ROSTER" },
    { telegramUserId: SRF, tgName: "Srf", personId: ids.srfMan, registeredAt: new Date(), source: "ROSTER" },
  ]);
  await db.insert(wbCommanderChat).values({ subunitId: ids.hq, chatId: -1000, threadId: null, chatTitle: "HQ" });
  tg.calls = [];
}
async function as(tgId: number) {
  jar.clear();
  await signIn({ id: tgId, first_name: `T${tgId}` });
}
const day = (n: number) => addDays(todaySgt(), n);
const slash = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const send = (over: Record<string, unknown> = {}) =>
  actions.sendClaim({ vehicle: "TAXI", first: day(1), also: [], start: { kind: "HOME" }, end: { kind: "OFFICE" }, reason: "ct scan", roundTrip: false, ...over } as Parameters<typeof actions.sendClaim>[0]);
const dms = () => tg.calls.filter((c) => c.method === "sendMessage");

describe("submitting a claim (DB)", () => {
  it("one row per day, appended to the sheet under the OC's columns, with his full name and his camp's address", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    const res = await send({ also: [day(3), day(2)], roundTrip: true });
    expect(res).toMatchObject({ ok: true, data: { days: [day(1), day(2), day(3)], sheet: "sent" } });

    const rows = await db.select().from(wbClaim).orderBy(wbClaim.tripDate);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows.every((r) => r.exportedAt && r.state === "PENDING")).toBe(true);
    expect(rows.map((r) => r.sheetRow)).toEqual([2, 3, 4]);

    const sheet = sheetState.tabs!["Pending Requests"];
    expect(sheet).toHaveLength(4);
    expect(sheet[1].slice(0, 3)).toEqual(["", "", ""]);
    expect(sheet[1].slice(3, 12)).toEqual([rows[0].rank, "TAN AH KOW BIN ABDULLAH", "PLATOON 7", "TAXI", slash(day(1)), "HOME", "BEDOK CAMP", "CT SCAN", "YES"]);
    expect(sheet[1][12]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    // nothing is said on Telegram: the OC decides on his sheet
    expect(dms()).toHaveLength(0);
  });

  it("a pair's man claims to his camp's one address; without a full name, his roster name", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(SRF);
    expect((await send({ start: { kind: "OFFICE" }, end: { kind: "OTHER", text: "sgh" } })).ok).toBe(true);
    const [r] = await db.select().from(wbClaim);
    expect([r.startPlace, r.endPlace, r.platoon]).toEqual(["SELARANG CAMP", "SGH", "PLATOON 6"]);
    const [p] = await db.select({ name: person.name }).from(person).where(eq(person.id, ids.srfMan));
    expect(r.sheetName).toBe(p.name.toUpperCase());
  });

  it("refuses the past and a day outside the fortnight, and writes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    expect(await send({ first: day(-1) })).toMatchObject({ ok: false, error: expect.stringMatching(/before the trip/) });
    expect(await send({ also: [day(20)] })).toMatchObject({ ok: false });
    expect(await send({ reason: "" })).toMatchObject({ ok: false });
    expect(await db.select().from(wbClaim)).toHaveLength(0);
    expect(sheetState.tabs!["Pending Requests"]).toHaveLength(1);
  });

  it("with the sheet not set or failing, the claim is saved and the evening round sends it", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    const tabs = sheetState.tabs;
    sheetState.tabs = null;
    expect(await send()).toMatchObject({ ok: true, data: { sheet: "not-set" } });
    sheetState.tabs = tabs;
    sheetState.fail = true;
    expect(await send({ first: day(2) })).toMatchObject({ ok: true, data: { sheet: "failed" } });
    let rows = await db.select().from(wbClaim);
    expect(rows.every((r) => !r.exportedAt)).toBe(true);
    expect(rows.find((r) => r.tripDate === day(2))!.exportError).toMatch(/503/);

    sheetState.fail = false;
    await eveningRound(await courier(), new Date(), { force: true });
    rows = await db.select().from(wbClaim);
    expect(rows.every((r) => r.exportedAt)).toBe(true);
    expect(sheetState.tabs!["Pending Requests"]).toHaveLength(3);
  });
});

describe("the OC's verdicts (DB)", () => {
  it("read back from any tab: approved, rejected with remarks, deleted; the man told once", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    await send({ also: [day(2), day(3)] });
    const pending = sheetState.tabs!["Pending Requests"];
    // the OC approves day 1 in place; his script moves day 2, rejected, to Processed; a PS deletes day 3
    pending[1][0] = "APPROVED";
    const moved = [...pending[2]];
    moved[0] = "REJECTED";
    moved[1] = "Take the bus";
    sheetState.tabs!["Processed Requests"].push(moved);
    pending.splice(2, 2);
    // a row only just written isn't "deleted" yet: it may not be readable
    expect(await claims.readVerdicts(new ClaimSheet(memorySheet(sheetState.tabs!), "Pending Requests"))).toBe(2);
    let rows = await db.select().from(wbClaim).orderBy(wbClaim.tripDate);
    expect(rows.map((r) => [r.state, r.remarks])).toEqual([
      ["APPROVED", ""],
      ["REJECTED", "Take the bus"],
      ["PENDING", ""],
    ]);

    await db.update(wbClaim).set({ exportedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const s = await eveningRound(await courier(), new Date(), { force: true });
    expect(s.claimsDecided).toBe(1);
    expect(s.claimsTold).toBe(1);
    rows = await db.select().from(wbClaim).orderBy(wbClaim.tripDate);
    expect(rows.map((r) => r.state)).toEqual(["APPROVED", "REJECTED", "REMOVED"]);
    const told = dms().filter((c) => c.payload.chat_id === MAN);
    expect(told).toHaveLength(1);
    expect(String(told[0].payload.text)).toMatch(/^✅ Transport claim approved\n\n• TAXI .+ · HOME → BEDOK CAMP · CT SCAN\n\n❌ Transport claim rejected\n\n.+\n  OC: Take the bus\n\n🗑 Transport claim removed/);

    tg.calls = [];
    const again = await eveningRound(await courier(), new Date(), { force: true });
    expect(again.claimsTold).toBe(0);
    expect(dms().filter((c) => c.payload.chat_id === MAN)).toHaveLength(0);
  });

  it("COY HQ hears about claims the OC has left more than 12 hours", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    await send();
    await db.update(wbClaim).set({ createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) });
    await eveningRound(await courier(), new Date(), { force: true });
    const hq = dms().find((c) => c.payload.chat_id === -1000);
    expect(String(hq?.payload.text)).toMatch(/🚕 1 transport claim waiting on the OC's sheet more than 12 hours\nhttps:\/\/sheet.example/);
  });
});

describe("FEATURE_CLAIMS off (DB)", () => {
  it("the action 404s, nothing is written, the evening round leaves claims alone", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await as(MAN);
    await send();
    vi.stubEnv("FEATURE_CLAIMS", "");
    await expect(send({ first: day(2) })).rejects.toThrow();
    expect(await db.select().from(wbClaim)).toHaveLength(1);
    sheetState.tabs!["Pending Requests"][1][0] = "APPROVED";
    const s = await eveningRound(await courier(), new Date(), { force: true });
    expect([s.claimsDecided, s.claimsTold]).toEqual([0, 0]);
    expect((await db.select().from(wbClaim))[0].state).toBe("PENDING");
  });
});
