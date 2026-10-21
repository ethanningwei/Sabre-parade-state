// ORD through the evening round: the send-off DM, full removal from the
// roster, his platoon's and COY HQ's lines, the warning the evening before,
// once per ORD date (an admin reopening him sticks), a missed round caught
// up, the admins kept, a waiting account switched off. Uses sabre_test;
// skipped if unreachable.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, camp, person, subunit } from "@/lib/db/schema";
import { wbAssignment, wbAudit, wbCard, wbGrant, wbMember, wbProjection, wbRecord, wbRfRequest } from "@/lib/wb/db/schema";
import type { GrantRow } from "@/lib/wb/domain/access";
import { addDays, todaySgt } from "@/lib/wb/domain/timeline";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier, type Sent } from "./recording-courier";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { eveningRound } = await import("@/lib/wb/evening");

let reachable = true;
const ids = { pl6: "", hq: "", slr: "" };
let slr: { id: string; name: string; rank: string }[] = [];

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
});
async function clean() {
  await db.delete(wbCard);
  await db.delete(wbProjection);
  await db.delete(wbAssignment);
  await db.delete(wbRfRequest);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
}
beforeEach(async () => {
  if (!reachable) return;
  vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
  await clean();
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  ids.pl6 = (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6")))[0].id;
  ids.hq = (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.isHq, true)))[0].id;
  ids.slr = (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR")))[0].id;
  slr = await db.select({ id: person.id, name: person.name, rank: person.rank }).from(person).where(and(eq(person.campId, ids.slr), eq(person.active, true))).orderBy(asc(person.sortOrder));
  await db.update(absence).set({ closedAt: new Date() }).where(and(inArray(absence.personId, slr.map((p) => p.id)), isNull(absence.closedAt)));
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

const now = new Date();
const today = todaySgt(now);
let tg = 7000;
async function member(opts: { personId?: string | null; ordDate: string | null; grants?: Omit<GrantRow, "campId">[]; self?: boolean }) {
  const [m] = await db
    .insert(wbMember)
    .values({
      telegramUserId: ++tg,
      tgName: "T",
      registeredAt: new Date(),
      personId: opts.personId ?? null,
      ordDate: opts.ordDate,
      ...(opts.self ? { source: "SELF" as const, selfName: "SELF MAN", selfRank: "PTE", selfRole: "ST CBT", selfCampId: ids.slr } : {}),
    })
    .returning();
  for (const g of opts.grants ?? []) await db.insert(wbGrant).values({ memberId: m.id, role: g.role, subunitId: g.subunitId });
  return m;
}
const round = async () => {
  const c = recordingCourier();
  const summary = await eveningRound(c, now, { force: true });
  return { c, summary };
};
const dmTo = (sent: Sent[], telegramId: number) => sent.filter((s) => "send" in s && "telegramId" in s.send && s.send.telegramId === telegramId).map((s) => (s as { text: string }).text);
const digestOf = (sent: Sent[], subunitId: string) =>
  (sent.find((s) => "send" in s && "platoon" in s.send && s.send.platoon === subunitId) as { text: string } | undefined)?.text ?? "";
const memberRow = async (id: string) => (await db.select().from(wbMember).where(eq(wbMember.id, id)))[0];
const personActive = async (id: string) => (await db.select({ a: person.active }).from(person).where(eq(person.id, id)))[0].a;

describe("ORD at the evening round", () => {
  it("sends him off and removes him fully; his platoon and COY HQ are told; tomorrow's man is warned", async (ctx) => {
    if (!reachable) ctx.skip();
    const ps = await member({ personId: slr[1].id, ordDate: today, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const [pending] = await db
      .insert(wbRecord)
      .values({ personId: slr[1].id, kind: "AL", startAt: new Date(now.getTime() + 3 * 864e5), endAt: new Date(now.getTime() + 5 * 864e5), absent: true, state: "PENDING", createdVia: "SELF", leaveDays: 2 })
      .returning();
    const soon = await member({ personId: slr[2].id, ordDate: addDays(today, 1) });

    const { c, summary } = await round();
    expect(summary).toMatchObject({ ord: 1, ordTomorrow: 1, ordKept: 0 });
    expect(await personActive(slr[1].id)).toBe(false);
    expect(await memberRow(ps.id)).toMatchObject({ active: false });
    expect(await db.select().from(wbGrant).where(eq(wbGrant.memberId, ps.id))).toEqual([]);
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, pending.id)))[0]).toMatchObject({ state: "WITHDRAWN", decisionNote: "Removed from roster at ORD" });
    const ord = await db.select({ after: wbAudit.after, via: wbAudit.via }).from(wbAudit).where(and(eq(wbAudit.action, "ord"), eq(wbAudit.entityId, ps.id)));
    expect(ord).toEqual([{ via: "SYSTEM", after: { ordDate: today, removed: true, personId: slr[1].id } }]);

    expect(dmTo(c.sent, ps.telegramUserId)).toEqual([
      `OWADIOOOO 🎉\n\nToday's your ORD, ${slr[1].rank} ${slr[1].name}. Thank you for your service, and all the best from Sabre coy!\n\nYour Sabre account closes tonight; your PS can reopen it if anything's left to settle.`,
    ]);
    expect(dmTo(c.sent, soon.telegramUserId)).toEqual([]);
    const pl6 = digestOf(c.sent, ids.pl6);
    expect(pl6).toContain(`🎉 ORD today: ${slr[1].rank} ${slr[1].name} (SLR). Off the roster tonight.`);
    expect(pl6).toContain(`🎓 ORD tomorrow: ${slr[2].rank} ${slr[2].name} (SLR).`);
    expect(digestOf(c.sent, ids.hq)).toContain(`🎉 1 ORD today, company-wide\n• ${slr[1].rank} ${slr[1].name} (SLR · PLATOON 6)`);
    expect(await personActive(slr[2].id)).toBe(true);
  });

  it("once per ORD date: a reopened account stays open; a missed round is caught up; a corrected date is acted on", async (ctx) => {
    if (!reachable) ctx.skip();
    const yesterday = addDays(today, -1);
    const m = await member({ personId: slr[3].id, ordDate: yesterday });
    let { c } = await round();
    expect(dmTo(c.sent, m.telegramUserId)[0]).toContain(`Your ORD was on ${yesterday.slice(8, 10)}/${yesterday.slice(5, 7)}, ${slr[3].rank} ${slr[3].name}.`);
    expect(await personActive(slr[3].id)).toBe(false);

    // an admin reopens him: the next evening leaves him alone
    await db.update(wbMember).set({ active: true }).where(eq(wbMember.id, m.id));
    await db.update(person).set({ active: true }).where(eq(person.id, slr[3].id));
    ({ c } = await round());
    expect(dmTo(c.sent, m.telegramUserId)).toEqual([]);
    expect((await memberRow(m.id)).active).toBe(true);

    // his real ORD is today
    await db.update(wbMember).set({ ordDate: today }).where(eq(wbMember.id, m.id));
    ({ c } = await round());
    expect(dmTo(c.sent, m.telegramUserId)).toHaveLength(1);
    expect((await memberRow(m.id)).active).toBe(false);
  });

  it("keeps a bootstrap admin and the last admin, tells the admins, and writes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const boot = await member({ personId: slr[4].id, ordDate: today });
    const last = await member({ personId: slr[5].id, ordDate: today, grants: [{ role: "ADMIN", subunitId: null }] });
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", String(boot.telegramUserId));
    const { c, summary } = await round();
    expect(summary).toMatchObject({ ord: 0, ordKept: 2 });
    expect(dmTo(c.sent, boot.telegramUserId)).toEqual([]);
    expect(dmTo(c.sent, last.telegramUserId)).toEqual([]);
    expect(await personActive(slr[4].id)).toBe(true);
    expect(await personActive(slr[5].id)).toBe(true);
    const kept = c.sent.find((s) => "send" in s && "admins" in s.send && (s as { text: string }).text.startsWith("🎓 ORD today but kept")) as { text: string };
    expect(kept.text).toContain("is in WB_ADMIN_TELEGRAM_IDS");
    expect(kept.text).toContain("is the last Sabre admin");
    expect(await db.select().from(wbAudit).where(eq(wbAudit.action, "ord"))).toEqual([]);
    expect(digestOf(c.sent, ids.pl6)).not.toContain("ORD today");
  });

  it("a waiting account is switched off with the DM and no digest line; a future or missing date is left alone", async (ctx) => {
    if (!reachable) ctx.skip();
    const waiting = await member({ ordDate: today, self: true });
    const later = await member({ personId: slr[6].id, ordDate: addDays(today, 30) });
    const none = await member({ personId: slr[7].id, ordDate: null });
    const { c, summary } = await round();
    expect(summary.ord).toBe(1);
    expect(await memberRow(waiting.id)).toMatchObject({ active: false });
    expect(dmTo(c.sent, waiting.telegramUserId)[0]).toMatch(/^OWADIOOOO 🎉\n\nToday's your ORD, PTE SELF MAN\./);
    expect(digestOf(c.sent, ids.pl6)).not.toContain("ORD today");
    expect((await memberRow(later.id)).active).toBe(true);
    expect((await memberRow(none.id)).active).toBe(true);
  });
});
