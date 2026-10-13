// The in-place import: people are matched and updated, never wiped, so what
// hangs off them survives; "roster" mode leaves absences, duties and on-shift
// alone. Needs the test DB; skipped if it can't be reached. Each test starts
// from the example with no inactive people, so nothing old gets revived.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RosterBlockedError, writeCoy, type CoyInput } from "@/lib/data/write-coy";
import { getCoyByKey, loadSnapshot } from "@/lib/data/snapshot";
import { db } from "@/lib/db";
import { absence, camp, coy, duty, person } from "@/lib/db/schema";
import { renderParadeState } from "@/lib/parade";
import { wbMember } from "@/lib/wb/db/schema";
import { EXAMPLE_CAA, exampleSnapshot } from "../fixtures/example-snapshot";

const golden = readFileSync(join(__dirname, "../fixtures/example-300926.txt"), "utf8");
const input = (): CoyInput => ({ ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
const TG = 990001;

let reachable = true;
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
  }
});
beforeEach(async () => {
  if (!reachable) return;
  await db.delete(wbMember).where(eq(wbMember.telegramUserId, TG));
  await writeCoy(db, input()); // back to the example, in full
  await db.delete(person).where(eq(person.active, false)); // so nothing from earlier runs is revived
});
afterAll(async () => {
  if (reachable) await db.delete(wbMember).where(eq(wbMember.telegramUserId, TG));
  await db.$client.end();
});

async function find(campName: string, name: string) {
  const [p] = await db
    .select({ id: person.id, active: person.active, rank: person.rank, campName: camp.name })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(eq(person.name, name), eq(camp.name, campName)))
    .orderBy(desc(person.active)); // the active one when there's history
  return p;
}
const byName = async (name: string) =>
  db.select({ id: person.id, active: person.active, campName: camp.name }).from(person).innerJoin(camp, eq(camp.id, person.campId)).where(eq(person.name, name));
const snapshot = async () => loadSnapshot(await getCoyByKey("SABRE"));

describe("writeCoy in place", () => {
  it("re-importing keeps every person's id and their Telegram link", async (ctx) => {
    if (!reachable) ctx.skip();
    const before = await find("TFT", "TFT PRESENT 1");
    await db.insert(wbMember).values({ telegramUserId: TG, personId: before.id });
    await writeCoy(db, input());
    await writeCoy(db, input(), "roster");
    expect((await find("TFT", "TFT PRESENT 1")).id).toBe(before.id);
    const [m] = await db.select({ personId: wbMember.personId }).from(wbMember).where(eq(wbMember.telegramUserId, TG));
    expect(m.personId).toBe(before.id);
    expect(renderParadeState(await snapshot(), EXAMPLE_CAA)).toBe(golden);
  });

  it("follows a man to his new camp, edits rank, adds and marks the missing inactive", async (ctx) => {
    if (!reachable) ctx.skip();
    const moving = await find("TFT", "TFT PRESENT 1");
    const leaving = await find("TFT", "TFT PRESENT 2");
    const data = input();
    const camps = data.subunits.flatMap((s) => s.camps);
    const tft = camps.find((c) => c.name === "TFT")!;
    const hdn = camps.find((c) => c.name === "HDN")!;
    const man = tft.people.find((p) => p.name === "TFT PRESENT 1")!;
    tft.people = tft.people.filter((p) => p.name !== "TFT PRESENT 1" && p.name !== "TFT PRESENT 2");
    hdn.people.push({ ...man, rank: "LCP" });
    hdn.people.push({ id: "new", name: "BRAND NEW", rank: "PTE", role: "", absence: null });

    const result = await writeCoy(db, data, "roster");
    expect(result).toMatchObject({ moved: 1, added: 1, removed: 1 });
    expect((await byName("TFT PRESENT 1")).filter((r) => r.active)).toEqual([{ id: moving.id, active: true, campName: "HDN" }]);
    expect((await find("HDN", "TFT PRESENT 1")).rank).toBe("LCP");
    expect((await byName("TFT PRESENT 2")).find((r) => r.id === leaving.id)).toEqual({ id: leaving.id, active: false, campName: "TFT" });
    expect((await byName("BRAND NEW")).filter((r) => r.active)).toHaveLength(1);
    const names = (await snapshot()).subunits.flatMap((s) => s.camps.flatMap((c) => c.people.map((p) => p.name)));
    expect(names).toContain("BRAND NEW");
    expect(names).not.toContain("TFT PRESENT 2");
  });

  it("brings a man back, same id and Telegram link, when the Sheet has him again", async (ctx) => {
    if (!reachable) ctx.skip();
    const p = await find("TFT", "TFT PRESENT 2");
    await db.insert(wbMember).values({ telegramUserId: TG, personId: p.id });
    const without = input();
    const tft = without.subunits.flatMap((s) => s.camps).find((c) => c.name === "TFT")!;
    tft.people = tft.people.filter((x) => x.name !== "TFT PRESENT 2");
    await writeCoy(db, without, "roster");
    expect((await find("TFT", "TFT PRESENT 2")).active).toBe(false);
    expect(await writeCoy(db, input(), "roster")).toMatchObject({ revived: 1, added: 0 });
    expect((await byName("TFT PRESENT 2")).filter((r) => r.active)).toEqual([{ id: p.id, active: true, campName: "TFT" }]);
    const [m] = await db.select({ personId: wbMember.personId }).from(wbMember).where(eq(wbMember.telegramUserId, TG));
    expect(m.personId).toBe(p.id);
  });

  it("roster mode leaves absences, duties, on-shift and the Telegram chat as the app has them", async (ctx) => {
    if (!reachable) ctx.skip();
    const p = await find("TFT", "TFT PRESENT 1");
    await db.insert(absence).values({ personId: p.id, type: "MC", startDate: "2026-09-30", endDate: "2026-10-01" });
    const c = await getCoyByKey("SABRE");
    await db.update(camp).set({ onShift: false }).where(eq(camp.name, "TFT"));
    await db.update(coy).set({ telegramChatId: "-100999" }).where(eq(coy.id, c.id));
    const duties = await db.select({ id: duty.id }).from(duty).where(eq(duty.coyId, c.id));

    await writeCoy(db, input(), "roster");
    expect(await db.select({ type: absence.type }).from(absence).where(eq(absence.personId, p.id))).toEqual([{ type: "MC" }]);
    expect((await db.select({ on: camp.onShift }).from(camp).where(eq(camp.name, "TFT")))[0].on).toBe(false);
    expect((await getCoyByKey("SABRE")).telegramChatId).toBe("-100999");
    expect(await db.select({ id: duty.id }).from(duty).where(eq(duty.coyId, c.id))).toEqual(duties);

    // full mode puts the example back
    await writeCoy(db, input(), "full");
    expect(await db.select({ type: absence.type }).from(absence).where(eq(absence.personId, p.id))).toEqual([]);
    expect(renderParadeState(await snapshot(), EXAMPLE_CAA)).toBe(golden);
  });

  it("refuses, writing nothing, when names are ambiguous or the Sheet dropped a camp", async (ctx) => {
    if (!reachable) ctx.skip();
    const dup = input();
    const camps = dup.subunits.flatMap((s) => s.camps);
    camps.find((c) => c.name === "HDN")!.people.push({ id: "d1", name: "TWIN", rank: "PTE", role: "", absence: null });
    camps.find((c) => c.name === "TFT")!.people.push({ id: "d2", name: "TWIN", rank: "PTE", role: "", absence: null });
    await writeCoy(db, dup, "roster"); // two TWINs in different camps: fine while they stay put
    camps.find((c) => c.name === "HDN")!.people.pop();
    camps.find((c) => c.name === "TFT")!.people.pop();
    camps.find((c) => c.name === "SLR")!.people.push({ id: "d3", name: "TWIN", rank: "PTE", role: "", absence: null });
    await expect(writeCoy(db, dup, "roster")).rejects.toThrow(RosterBlockedError);
    expect((await byName("TWIN")).filter((r) => r.active).map((r) => r.campName).sort()).toEqual(["HDN", "TFT"]);

    const dropped = input();
    dropped.subunits[1].camps = dropped.subunits[1].camps.filter((c) => c.name !== "HDN");
    await expect(writeCoy(db, dropped, "roster")).rejects.toThrow(/Camp HDN isn't in the Sheet/);
    expect(await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "HDN"))).toHaveLength(1);
  });
});
