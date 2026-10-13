// Admin actions and Gaps through the database. Uses sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { signIn } = await import("@/lib/wb/auth");
const { addGrant, removeGrant, linkMember, setMemberActive } = await import("@/lib/wb/actions/admin");
const { gaps, gapsFor } = await import("@/lib/wb/admin-data");

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
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
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
async function signInAs(telegramUserId: number) {
  jar.clear();
  await signIn({ id: telegramUserId, first_name: "T" });
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
    await signInAs(1);
    expect(await addGrant({ memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
    });

    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "1");
    await signInAs(1);
    expect(await addGrant({ memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({ ok: true, data: undefined });
    expect(await addGrant({ memberId: target.id, role: "PS", scope: `subunit:${pl6}` })).toEqual({
      ok: false,
      error: "They already have that role there.",
    });
    expect(await addGrant({ memberId: target.id, role: "OC", scope: "company" })).toMatchObject({ ok: true });
    const grants = await db.select().from(wbGrant).where(eq(wbGrant.memberId, target.id));
    expect(grants.map((g) => [g.role, g.subunitId])).toEqual(expect.arrayContaining([["PS", pl6], ["OC", null]]));
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  });

  it("won't remove the last admin, or let an admin deactivate themselves", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "1");
    await signInAs(1);
    const [me] = await db.select().from(wbMember).where(eq(wbMember.telegramUserId, 1));
    const [mine] = await db.select().from(wbGrant).where(eq(wbGrant.memberId, me.id));
    expect(await removeGrant(mine.id)).toEqual({ ok: false, error: "That's the last admin. Make someone else an admin first." });
    expect(await setMemberActive(me.id, false)).toEqual({ ok: false, error: "You can't deactivate yourself." });

    const other = await registered(3);
    await addGrant({ memberId: other.id, role: "ADMIN", scope: "company" });
    expect(await removeGrant(mine.id)).toEqual({ ok: true, data: undefined });
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  });

  it("links a SELF sign-up once they're on the roster, and Gaps follows", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "1");
    await signInAs(1);
    const [tft] = await db.select().from(camp).where(eq(camp.name, "TFT"));
    const self = await registered(4, { source: "SELF", selfName: "NEW GUY", selfRank: "PTE", selfCampId: tft.id });
    const tft1 = await personNamed("TFT PRESENT 1");
    const tft2 = await personNamed("TFT PRESENT 2");
    await registered(5, { personId: tft2.id, source: "ROSTER" });

    let g = await gaps();
    expect(g.selfOnly.map((m) => m.label)).toEqual(["PTE NEW GUY"]);
    expect(g.unregistered.some((p) => p.name === "TFT PRESENT 1")).toBe(true);
    expect(g.unregistered.some((p) => p.name === "TFT PRESENT 2")).toBe(false);

    // can't take a person someone else has
    expect((await linkMember(self.id, tft2.id)).ok).toBe(false);
    expect(await linkMember(self.id, tft1.id)).toEqual({ ok: true, data: undefined });
    g = await gaps();
    expect(g.selfOnly).toEqual([]);
    expect(g.unregistered.some((p) => p.name === "TFT PRESENT 1")).toBe(false);

    // their person leaves the roster
    await db.update(person).set({ active: false }).where(eq(person.id, tft1.id));
    g = await gaps();
    expect(g.left.map((m) => m.label)).toEqual(["PTE TFT PRESENT 1"]);
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  });

  it("Gaps is the viewer's own platoon unless their grant is company-wide", async (ctx) => {
    if (!reachable) ctx.skip();
    const [pl5] = await db.select().from(subunit).where(eq(subunit.name, "PLATOON 5"));
    const [tft] = await db.select().from(camp).where(eq(camp.name, "TFT"));
    const [slr] = await db.select().from(camp).where(eq(camp.name, "SLR"));
    await registered(6, { source: "SELF", selfName: "PL5 GUY", selfRank: "PTE", selfCampId: tft.id });
    await registered(7, { source: "SELF", selfName: "PL6 GUY", selfRank: "PTE", selfCampId: slr.id });
    await registered(8, { source: "SELF", selfName: "NOWHERE", selfRank: "PTE" });

    const ps5 = await gapsFor([{ role: "PS", subunitId: pl5.id, campId: null }]);
    expect(ps5.scoped).toBe(true);
    expect(new Set(ps5.unregistered.map((p) => p.subunitName))).toEqual(new Set(["PLATOON 5"]));
    expect(ps5.selfOnly.map((m) => m.label)).toEqual(["PTE PL5 GUY"]);

    const oc = await gapsFor([{ role: "OC", subunitId: null, campId: null }]);
    expect(oc.scoped).toBe(false);
    expect(oc.selfOnly.map((m) => m.label).sort()).toEqual(["PTE NOWHERE", "PTE PL5 GUY", "PTE PL6 GUY"]);
    expect(oc.unregistered.length).toBe((await gaps()).unregistered.length);
  });
});
