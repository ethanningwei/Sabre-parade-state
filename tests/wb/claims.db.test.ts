// Transport claims through the database, called as the Mini App calls the
// write: submit (one row per day, onto the OC's sheet with his columns
// untouched), the sheet not set or failing (saved, sent at the evening
// round), reading his verdicts back wherever his script moved the row
// (approved, rejected with remarks, deleted), the trooper's DM once, COY HQ's
// digest line, and nothing at all with FEATURE_CLAIMS off. The sheet is in
// memory; the Courier records. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbClaim, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { CLAIM_HEADERS } from "@/lib/wb/domain/claims";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day } from "./writes";

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

const actions = await import("@/lib/wb/actions/claims");
const claims = await import("@/lib/wb/claims");
const { eveningRound } = await import("@/lib/wb/evening");
const { ClaimSheet, claimSheet, memorySheet } = await import("@/lib/wb/sheets");

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
}
const slash = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const input = (over: Partial<Parameters<typeof claims.submitClaim>[2]> = {}): Parameters<typeof claims.submitClaim>[2] => ({
  vehicle: "TAXI",
  first: day(1),
  also: [],
  start: { kind: "HOME" },
  end: { kind: "OFFICE" },
  reason: "ct scan",
  roundTrip: false,
  ...over,
});
/** His claim, as the Mini App sends it, to whatever the sheet is now. */
const send = async (tgId: number, over: Partial<Parameters<typeof claims.submitClaim>[2]> = {}) => claims.submitClaim(claimSheet(), await acting(tgId), input(over));
const toMan = (c: ReturnType<typeof recordingCourier>) => c.sent.flatMap((x) => ("send" in x && "person" in x.send && x.send.person === ids.man ? [x.text] : []));

describe("submitting a claim (DB)", () => {
  it("one row per day, appended to the sheet under the OC's columns, with his full name and his camp's address", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const res = await send(MAN, { also: [day(3), day(2)], roundTrip: true });
    expect(res).toMatchObject({ ok: true, value: { sheet: "sent" } });
    expect(res.ok && res.value.rows.map((r) => r.tripDate)).toEqual([day(1), day(2), day(3)]);
    expect(await db.select({ action: wbAudit.action, via: wbAudit.via }).from(wbAudit)).toEqual([{ action: "claim-submit", via: "MINIAPP" }]);

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
  });

  it("a pair's man claims to his camp's one address; without a full name, his roster name", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    expect((await send(SRF, { start: { kind: "OFFICE" }, end: { kind: "OTHER", text: "sgh" } })).ok).toBe(true);
    const [r] = await db.select().from(wbClaim);
    expect([r.startPlace, r.endPlace, r.platoon]).toEqual(["SELARANG CAMP", "SGH", "PLATOON 6"]);
    const [p] = await db.select({ name: person.name }).from(person).where(eq(person.id, ids.srfMan));
    expect(r.sheetName).toBe(p.name.toUpperCase());
  });

  it("refuses the past and a day outside the fortnight, and writes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    expect(await send(MAN, { first: day(-1) })).toMatchObject({ ok: false, error: expect.stringMatching(/before the trip/) });
    expect(await send(MAN, { also: [day(20)] })).toMatchObject({ ok: false });
    expect(await send(MAN, { start: { kind: "HOME" }, end: { kind: "HOME" } })).toEqual({ ok: false, error: "The trip starts and ends in the same place. Is it a round trip?" });
    expect(await db.select().from(wbClaim)).toHaveLength(0);
    expect(sheetState.tabs!["Pending Requests"]).toHaveLength(1);
  });

  it("with the sheet not set or failing, the claim is saved and the evening round sends it", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    const tabs = sheetState.tabs;
    sheetState.tabs = null;
    expect(await send(MAN)).toMatchObject({ ok: true, value: { sheet: "not-set" } });
    sheetState.tabs = tabs;
    sheetState.fail = true;
    expect(await send(MAN, { first: day(2) })).toMatchObject({ ok: true, value: { sheet: "failed" } });
    let rows = await db.select().from(wbClaim);
    expect(rows.every((r) => !r.exportedAt)).toBe(true);
    expect(rows.find((r) => r.tripDate === day(2))!.exportError).toMatch(/503/);

    sheetState.fail = false;
    await eveningRound(recordingCourier(), new Date(), { force: true });
    rows = await db.select().from(wbClaim);
    expect(rows.every((r) => r.exportedAt)).toBe(true);
    expect(sheetState.tabs!["Pending Requests"]).toHaveLength(3);
  });
});

describe("the OC's verdicts (DB)", () => {
  it("read back from any tab: approved, rejected with remarks, deleted (gone, untold); the man told once", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await send(MAN, { also: [day(2), day(3)] });
    const pending = sheetState.tabs!["Pending Requests"];
    // the OC approves day 1 in place; his script moves day 2, rejected, to Processed; a PS deletes day 3
    pending[1][0] = "APPROVED";
    const moved = [...pending[2]];
    moved[0] = "REJECTED";
    moved[1] = "Take the bus";
    sheetState.tabs!["Processed Requests"].push(moved);
    pending.splice(2, 2);
    // the sheet is the record: the deleted row is gone from the Mini App at once, with no message
    expect(await claims.readVerdicts(new ClaimSheet(memorySheet(sheetState.tabs!), "Pending Requests"))).toBe(3);
    const rows = await db.select().from(wbClaim).orderBy(wbClaim.tripDate);
    expect(rows.map((r) => [r.state, r.remarks])).toEqual([
      ["APPROVED", ""],
      ["REJECTED", "Take the bus"],
      ["REMOVED", ""],
    ]);
    expect((await claims.myClaims(ids.man)).map((c) => c.state)).toEqual(["REJECTED", "APPROVED"]);

    const c = recordingCourier();
    const s = await eveningRound(c, new Date(), { force: true });
    expect(s.claimsDecided).toBe(0);
    expect(s.claimsTold).toBe(1);
    const told = toMan(c);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^✅ Transport claim approved\n\n• TAXI .+ · HOME → BEDOK CAMP · CT SCAN\n\n❌ Transport claim rejected\n\n.+\n  OC: Take the bus$/);
    expect((await db.select().from(wbClaim)).every((r) => r.toldAt)).toBe(true);

    const c2 = recordingCourier();
    const again = await eveningRound(c2, new Date(), { force: true });
    expect(again.claimsTold).toBe(0);
    expect(toMan(c2)).toHaveLength(0);
  });

  it("COY HQ hears about claims the OC has left more than 12 hours", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await send(MAN);
    await db.update(wbClaim).set({ createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) });
    const c = recordingCourier();
    await eveningRound(c, new Date(), { force: true });
    const hq = c.sent.find((x) => "send" in x && "platoon" in x.send && x.send.platoon === ids.hq && x.text.includes("🚕"));
    expect(hq && "text" in hq ? hq.text : "").toMatch(/🚕 1 transport claim waiting on the OC's sheet more than 12 hours\nhttps:\/\/sheet.example/);
  });
});

describe("FEATURE_CLAIMS off (DB)", () => {
  it("the action 404s, nothing is written, the evening round leaves claims alone", async (ctx) => {
    if (!reachable) ctx.skip();
    await setup();
    await send(MAN);
    vi.stubEnv("FEATURE_CLAIMS", "");
    // the server action is a 404 before it reads anything
    await expect(actions.sendClaim({ ...input({ first: day(2) }), also: [] })).rejects.toThrow();
    expect(await db.select().from(wbClaim)).toHaveLength(1);
    sheetState.tabs!["Pending Requests"][1][0] = "APPROVED";
    const s = await eveningRound(recordingCourier(), new Date(), { force: true });
    expect([s.claimsDecided, s.claimsTold]).toEqual([0, 0]);
    expect((await db.select().from(wbClaim))[0].state).toBe("PENDING");
  });
});
