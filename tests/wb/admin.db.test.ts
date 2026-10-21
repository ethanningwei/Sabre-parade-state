// Admin's writes and Gaps through the database, called as the Mini App calls
// the writes (lib/wb/admin.ts): grants, the last admin, linking a SELF
// sign-up, and whose Roster is whose. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { addGrant, linkMember, removeGrant, setMemberActive } from "@/lib/wb/admin";
import { rosterFor } from "@/lib/wb/admin-data";
import { wbAudit, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { acting } from "./writes";

type Roster = Awaited<ReturnType<typeof rosterFor>>;
const COMPANY = [{ role: "OC" as const, subunitId: null, campId: null }];
/** On the roster, but nobody has registered as them. */
const unregistered = (r: Roster) => r.camps.flatMap((c) => c.people.filter((p) => !p.registered).map((p) => ({ ...p, subunitName: c.subunitName })));
const gaps = () => rosterFor(COMPANY);

let reachable = true;
let pl6: string;
beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
});
beforeEach(async () => {
  if (!reachable) return;
  await db.delete(wbAudit);
  await db.delete(wbCommanderChat);
  await db.delete(wbGrant);
  await db.delete(wbMember);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

async function registered(telegramUserId: number, extra: Partial<typeof wbMember.$inferInsert> = {}) {
  const [m] = await db.insert(wbMember).values({ telegramUserId, tgName: `T${telegramUserId}`, registeredAt: new Date(), ...extra }).returning();
  return m;
}
/** A registered admin, acting in the Mini App. */
async function admin(telegramUserId: number, extra: Partial<typeof wbMember.$inferInsert> = {}) {
  const m = await registered(telegramUserId, extra);
  await db.insert(wbGrant).values({ memberId: m.id, role: "ADMIN" });
  return acting(telegramUserId);
}
async function personNamed(name: string) {
  const [p] = await db.select().from(person).where(and(eq(person.name, name), eq(person.active, true)));
  return p;
}

describe("admin (DB)", () => {
  it("only an ADMIN can grant, and grants are unique", async (ctx) => {
    if (!reachable) ctx.skip();
    const target = await registered(2);
    await registered(1);
    expect(await addGrant(await acting(1), { memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
    });

    const me = await admin(9);
    expect(await addGrant(me, { memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({ ok: true, value: undefined });
    expect(await addGrant(me, { memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({
      ok: false,
      error: "They already have that role there.",
    });
    expect(await addGrant(me, { memberId: target.id, role: "OC", scope: "company" })).toMatchObject({ ok: true });
    const grants = await db.select().from(wbGrant).where(eq(wbGrant.memberId, target.id));
    expect(grants.map((g) => [g.role, g.subunitId])).toEqual(expect.arrayContaining([["PS", pl6], ["OC", null]]));
    expect((await db.select({ a: wbAudit.action, via: wbAudit.via, m: wbAudit.memberId }).from(wbAudit)).filter((r) => r.a === "grant")).toEqual([
      { a: "grant", via: "MINIAPP", m: me.actor.id },
      { a: "grant", via: "MINIAPP", m: me.actor.id },
    ]);
  });

  it("won't remove the last admin, or let an admin deactivate themselves", async (ctx) => {
    if (!reachable) ctx.skip();
    const me = await admin(1);
    const [mine] = await db.select().from(wbGrant).where(eq(wbGrant.memberId, me.actor.id));
    expect(await removeGrant(me, mine.id)).toEqual({ ok: false, error: "That's the last admin. Make someone else an admin first." });
    expect(await setMemberActive(me, me.actor.id, false)).toEqual({ ok: false, error: "You can't deactivate yourself." });

    const other = await registered(3);
    await addGrant(me, { memberId: other.id, role: "ADMIN", scope: "company" });
    expect(await removeGrant(me, mine.id)).toEqual({ ok: true, value: undefined });
  });

  it("links a SELF sign-up once they're on the roster, and Roster follows", async (ctx) => {
    if (!reachable) ctx.skip();
    // on the roster himself, so he isn't one of the waiting
    const me = await admin(1, { personId: (await personNamed("TFT PRESENT 3")).id, source: "ROSTER" });
    const [tft] = await db.select().from(camp).where(eq(camp.name, "TFT"));
    const self = await registered(4, { source: "SELF", selfName: "NEW GUY", selfRank: "PTE", selfCampId: tft.id });
    const tft1 = await personNamed("TFT PRESENT 1");
    const tft2 = await personNamed("TFT PRESENT 2");
    await registered(5, { personId: tft2.id, source: "ROSTER" });

    let g = await gaps();
    expect(g.waiting.map((m) => m.label)).toEqual(["PTE NEW GUY"]);
    expect(unregistered(g).some((p) => p.name === "TFT PRESENT 1")).toBe(true);
    expect(unregistered(g).some((p) => p.name === "TFT PRESENT 2")).toBe(false);

    // can't take a person someone else has
    expect((await linkMember(me, self.id, tft2.id)).ok).toBe(false);
    expect(await linkMember(me, self.id, tft1.id)).toEqual({ ok: true, value: undefined });
    g = await gaps();
    expect(g.waiting).toEqual([]);
    expect(unregistered(g).some((p) => p.name === "TFT PRESENT 1")).toBe(false);

    // their person leaves the roster
    await db.update(person).set({ active: false }).where(eq(person.id, tft1.id));
    g = await gaps();
    expect(g.left.map((m) => m.label)).toEqual(["PTE TFT PRESENT 1"]);
  });

  it("Roster is the viewer's own platoon (or a GC's camp) unless their grant is company-wide", async (ctx) => {
    if (!reachable) ctx.skip();
    const [pl5] = await db.select().from(subunit).where(eq(subunit.name, "PLATOON 5"));
    const [tft] = await db.select().from(camp).where(eq(camp.name, "TFT"));
    const [slr] = await db.select().from(camp).where(eq(camp.name, "SLR"));
    await registered(6, { source: "SELF", selfName: "PL5 GUY", selfRank: "PTE", selfCampId: tft.id });
    await registered(7, { source: "SELF", selfName: "PL6 GUY", selfRank: "PTE", selfCampId: slr.id });
    await registered(8, { source: "SELF", selfName: "NOWHERE", selfRank: "PTE" });

    const ps5 = await rosterFor([{ role: "PS", subunitId: pl5.id, campId: null }]);
    expect(ps5.reach).toBe("Your platoon");
    expect(new Set(ps5.camps.map((c) => c.subunitName))).toEqual(new Set(["PLATOON 5"]));
    expect(ps5.waiting.map((m) => m.label)).toEqual(["PTE PL5 GUY"]);

    const gc = await rosterFor([{ role: "GC", subunitId: null, campId: slr.id }]);
    expect(gc.reach).toBe("Your camp");
    expect(gc.camps.map((c) => c.name)).toEqual(["SLR"]);
    expect(gc.waiting.map((m) => m.label)).toEqual(["PTE PL6 GUY"]);
    // a GC grant given company-wide still reaches no further than a camp: here, nothing
    expect((await rosterFor([{ role: "GC", subunitId: null, campId: null }])).camps).toEqual([]);

    const oc = await rosterFor(COMPANY);
    expect(oc.reach).toBe("The whole company");
    expect(oc.waiting.map((m) => m.label).sort()).toEqual(["PTE NOWHERE", "PTE PL5 GUY", "PTE PL6 GUY"]);
    expect(oc.camps.reduce((n, c) => n + c.people.length, 0)).toBe((await db.select().from(person).where(eq(person.active, true))).length);
  });
});
