// The roster flow through the database: Remove from roster takes everything
// whereabouts holds for a man (open v1 duties, Extra/RF/SOL, pending requests,
// grants, account, projections) and keeps approved entries to come; Add to
// roster and Link to existing for a waiting account (scope, duplicates, races,
// the DM); + Add person and Edit on Roster (a GC's camp, moves, v1's own roles);
// the Home badge's count and the evening line's 24 hours; the waiting guard.
// Uses sabre_test; skipped if unreachable.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDutyCore } from "@/lib/core/duties";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, auditLog, camp, duty, person, subunit } from "@/lib/db/schema";
import { wbAssignment, wbAudit, wbCard, wbGrant, wbMember, wbProjection, wbRecord, wbRfRequest } from "@/lib/wb/db/schema";
import type { GrantRow } from "@/lib/wb/domain/access";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { signInitData, TEST_BOT_TOKEN, tgUser } from "./helpers";
import { recordingCourier } from "./recording-courier";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT FOUND");
  },
}));

const { signIn, requireRegistered, requireMember } = await import("@/lib/wb/auth");
const { addPersonToRoster, addToRoster, editRosterPerson, linkToRoster, removeFromRoster, removalPreview } = await import("@/lib/wb/roster-flow");
const { waitingCount, waitingByPlatoon } = await import("@/lib/wb/admin-data");
const { decide } = await import("@/lib/wb/decide");
const { loadPlanInput, PROJECTOR_USER } = await import("@/lib/wb/projection");
const { eveningRound } = await import("@/lib/wb/evening");
const { POST: authRoute } = await import("@/app/api/wb/auth/route");

const HOUR = 60 * 60 * 1000;
let reachable = true;
const ids = { pl6: "", pl7: "", hq: "", slr: "", bdk: "" };
let slr: { id: string; name: string; rank: string }[] = [];
let bdk: { id: string; name: string; rank: string }[] = [];

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
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
  jar.clear();
  await clean();
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const sub = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
  const campId = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
  ids.pl6 = await sub("PLATOON 6");
  ids.pl7 = await sub("PLATOON 7");
  ids.hq = await sub("COY HQ");
  ids.slr = await campId("SLR");
  ids.bdk = await campId("BDK");
  const at = (c: string) => db.select({ id: person.id, name: person.name, rank: person.rank }).from(person).where(and(eq(person.campId, c), eq(person.active, true))).orderBy(asc(person.sortOrder));
  slr = await at(ids.slr);
  bdk = await at(ids.bdk);
  // the example's own open absences would only blur the counts
  await db.update(absence).set({ closedAt: new Date() }).where(and(inArray(absence.personId, [...slr, ...bdk].map((p) => p.id)), isNull(absence.closedAt)));
});
afterAll(async () => {
  if (reachable) await clean();
  vi.unstubAllEnvs();
  await db.$client.end();
});

let tg = 5000;
type G = { role: GrantRow["role"]; subunitId?: string | null; campId?: string | null };
async function member(opts: { personId?: string | null; grants?: G[]; self?: { name: string; rank: string; role: string; campId: string }; registeredAt?: Date } = {}) {
  const [m] = await db
    .insert(wbMember)
    .values({
      telegramUserId: ++tg,
      tgName: `T${tg}`,
      registeredAt: opts.registeredAt ?? new Date(),
      personId: opts.personId ?? null,
      source: opts.self ? "SELF" : opts.personId ? "ROSTER" : null,
      selfName: opts.self?.name ?? null,
      selfRank: opts.self?.rank ?? null,
      selfRole: opts.self?.role ?? null,
      selfCampId: opts.self?.campId ?? null,
    })
    .returning();
  const grants: GrantRow[] = (opts.grants ?? []).map((g) => ({ role: g.role, subunitId: g.subunitId ?? null, campId: g.campId ?? null }));
  for (const g of grants) await db.insert(wbGrant).values({ memberId: m.id, ...g });
  return { ...m, grants, by: { actor: { id: m.id, personId: m.personId, grants, registered: !!m.registeredAt }, via: "MINIAPP" as const } };
}
const record = (personId: string, state: "PENDING" | "APPROVED", startAt: Date, days = 2) =>
  db
    .insert(wbRecord)
    .values({ personId, kind: "AL", startAt, endAt: new Date(startAt.getTime() + days * 24 * HOUR), absent: true, state, createdVia: "SELF", leaveDays: days })
    .returning()
    .then((r) => r[0]);
const auditActions = async () => (await db.select({ action: wbAudit.action }).from(wbAudit).orderBy(asc(wbAudit.at))).map((r) => r.action);

describe("Remove from roster", () => {
  it("takes everything with him, keeps approved leave to come, and he can no longer decide", async (ctx) => {
    if (!reachable) ctx.skip();
    const now = new Date();
    await db.delete(auditLog).where(eq(auditLog.entityId, slr[1].id)); // people outlive each test; so does their v1 audit
    const remover = await member({ personId: slr[0].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const target = await member({ personId: slr[1].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    // an open v1 RF at BDK, with its "RF @ BDK" home absence
    const d = await db.transaction((tx) => saveDutyCore(tx, null, { type: "RF", rank: "", name: "", personId: slr[1].id, campId: ids.bdk, startDate: "2026-10-01", startTime: null, endDate: "2099-12-31", endTime: null }));
    // the last man on a FILLED request
    const [req] = await db.insert(wbRfRequest).values({ campId: ids.bdk, role: "ANY", need: 1, startAt: new Date(now.getTime() - HOUR), endAt: new Date(now.getTime() + 48 * HOUR), state: "FILLED", raisedBy: remover.id }).returning();
    const [asg] = await db.insert(wbAssignment).values({ personId: slr[1].id, type: "RF", campId: ids.bdk, startAt: req.startAt, endAt: req.endAt, rfRequestId: req.id, state: "ACTIVE" }).returning();
    const pending = await record(slr[1].id, "PENDING", new Date(now.getTime() + 72 * HOUR));
    const ahead = await record(slr[1].id, "APPROVED", new Date(now.getTime() + 240 * HOUR));
    const inForce = await record(slr[1].id, "APPROVED", new Date(now.getTime() - HOUR));
    const [proj] = await db.insert(wbProjection).values({ kind: "ABSENCE", personId: slr[1].id, recordId: inForce.id }).returning();
    // someone else's request he could decide
    const other = await record(slr[2].id, "PENDING", new Date(now.getTime() + 96 * HOUR));

    expect(await removalPreview(slr[1].id, now)).toEqual({ absences: 1, duties: 1, assignments: 1, pending: 1, grants: ["PS · PLATOON 6"], account: true, ahead: 1 });

    const c = recordingCourier();
    const res = await removeFromRoster(c, remover.by, slr[1].id);
    expect(res).toMatchObject({ ok: true, value: { duties: 1, assignments: 1, withdrawn: 1, grants: 1, account: true, projections: 1 } });

    expect((await db.select().from(person).where(eq(person.id, slr[1].id)))[0].active).toBe(false);
    expect((await db.select().from(duty).where(eq(duty.id, d.id)))[0]).toMatchObject({ closedBy: PROJECTOR_USER.id });
    expect((await db.select().from(duty).where(eq(duty.id, d.id)))[0].closedAt).not.toBeNull();
    expect(await db.select().from(absence).where(and(eq(absence.personId, slr[1].id), isNull(absence.closedAt)))).toEqual([]);
    expect((await db.select().from(wbAssignment).where(eq(wbAssignment.id, asg.id)))[0]).toMatchObject({ state: "CANCELLED", cancelledBy: remover.id });
    expect((await db.select().from(wbRfRequest).where(eq(wbRfRequest.id, req.id)))[0].state).toBe("OPEN");
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, pending.id)))[0]).toMatchObject({ state: "WITHDRAWN", decisionNote: `Removed from roster by ${slr[0].rank} ${slr[0].name}` });
    expect((await db.select().from(wbRecord).where(eq(wbRecord.id, ahead.id)))[0].state).toBe("APPROVED");
    expect(await db.select().from(wbGrant).where(eq(wbGrant.memberId, target.id))).toEqual([]);
    expect((await db.select().from(wbMember).where(eq(wbMember.id, target.id)))[0]).toMatchObject({ active: false, personId: slr[1].id });
    expect((await db.select().from(wbProjection).where(eq(wbProjection.id, proj.id)))[0].close).toBe("VOID");
    expect(await auditActions()).toEqual(["end-duty", "stand-down", "withdraw", "revoke", "deactivate", "remove-from-roster"]);
    expect(await db.select({ userId: auditLog.userId }).from(auditLog).where(and(eq(auditLog.action, "remove-person"), eq(auditLog.entityId, slr[1].id)))).toEqual([{ userId: PROJECTOR_USER.id }]);

    // only card edits, nothing new pushed to a chat or to him
    expect(c.sent).toEqual([{ redraw: { record: pending.id } }, { redraw: { rf: req.id } }]);

    // he can't decide any more: no grants, no account
    const left = await db.select({ role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant).where(eq(wbGrant.memberId, target.id));
    expect((await decide(c, { actor: { id: target.id, personId: slr[1].id, grants: left, registered: true }, via: "MINIAPP" }, other.id, "approve")).ok).toBe(false);
    jar.clear();
    await signIn({ id: target.telegramUserId, first_name: "T" });
    await expect(requireMember()).rejects.toThrow("REDIRECT /tg");

    // and the projector never writes his approved leave, even once it's in force
    const input = await loadPlanInput(db, now);
    expect(input.records.filter((r) => r.personId === slr[1].id)).toEqual([]);
  });

  it("refuses another platoon's PS, himself and the last admin, changing nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = recordingCourier();
    const pl7 = await member({ personId: bdk[0].id, grants: [{ role: "PS", subunitId: ids.pl7 }] });
    expect(await removeFromRoster(c, pl7.by, slr[1].id)).toEqual({ ok: false, error: `Only PLATOON 6's PC or PS (or company command) can remove ${slr[1].rank} ${slr[1].name}.` });
    const ps = await member({ personId: slr[0].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    expect(await removeFromRoster(c, ps.by, slr[0].id)).toMatchObject({ ok: false, error: expect.stringMatching(/yourself/) });
    await member({ personId: slr[1].id, grants: [{ role: "ADMIN" }] });
    expect(await removeFromRoster(c, ps.by, slr[1].id)).toEqual({ ok: false, error: "He's the last Sabre admin. Make someone else an admin first." });
    expect((await db.select().from(person).where(eq(person.id, slr[1].id)))[0].active).toBe(true);
    expect(await auditActions()).toEqual([]);
    expect(c.sent).toEqual([]);
  });
});

describe("Add to roster", () => {
  const waiting = (registeredAt?: Date, campId = ids.slr) => member({ self: { name: "NEW GUY", rank: "PTE", role: "ST CBT", campId }, registeredAt });

  it("creates the v1 person (by the projector's user), links him, and DMs him", async (ctx) => {
    if (!reachable) ctx.skip();
    const ps = await member({ personId: slr[0].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const w = await waiting();
    const c = recordingCourier();
    const res = await addToRoster(c, ps.by, { memberId: w.id, campId: ids.slr, rank: "pte", name: " new   guy ", role: "ST CBT" });
    expect(res).toMatchObject({ ok: true, value: { label: "PTE NEW GUY" } });
    const [p] = await db.select().from(person).where(and(eq(person.campId, ids.slr), eq(person.name, "NEW GUY"), eq(person.active, true)));
    expect(p).toMatchObject({ rank: "PTE", role: "ST CBT" });
    expect((await db.select().from(wbMember).where(eq(wbMember.id, w.id)))[0]).toMatchObject({ personId: p.id, source: "ROSTER" });
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, "create-person"), eq(auditLog.entityId, p.id))))[0].userId).toBe(PROJECTOR_USER.id);
    expect(await auditActions()).toEqual(["roster-add", "link"]);
    expect(c.sent).toEqual([
      { send: { telegramId: w.telegramUserId }, text: "✅ You're on the parade state (SLR · PLATOON 6). Open Sabre to report sick, apply for leave and see your records.", buttons: [[{ text: "Open Sabre", route: "" }]] },
    ]);
  });

  it("refuses another platoon's PS, a camp outside his scope, a bad role, a duplicate name, and someone already added", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = recordingCourier();
    const ps = await member({ personId: slr[0].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const pl7 = await member({ personId: bdk[0].id, grants: [{ role: "PS", subunitId: ids.pl7 }] });
    const w = await waiting();
    const base = { memberId: w.id, campId: ids.slr, rank: "PTE", name: "NEW GUY", role: "ST CBT" };
    expect(await addToRoster(c, pl7.by, base)).toEqual({ ok: false, error: "He isn't in your platoon or camp." });
    expect(await addToRoster(c, ps.by, { ...base, campId: ids.bdk })).toEqual({ ok: false, error: "BDK isn't in your platoon or camp." });
    expect(await addToRoster(c, ps.by, { ...base, role: "PS" })).toEqual({ ok: false, error: "Pick a role that fits that camp." });
    expect(await addToRoster(c, ps.by, { ...base, name: slr[3].name.toLowerCase() })).toEqual({
      ok: false,
      error: `There's already a ${slr[3].rank} ${slr[3].name} in SLR. Link him to that person, or add a surname.`,
    });
    // someone linked him first
    await db.update(wbMember).set({ personId: slr[4].id }).where(eq(wbMember.id, w.id));
    expect(await addToRoster(c, ps.by, base)).toEqual({ ok: false, error: "Someone has just added him." });
    expect(await db.select().from(person).where(and(eq(person.name, "NEW GUY"), eq(person.active, true)))).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("an ASA (company) can add too", async (ctx) => {
    if (!reachable) ctx.skip();
    const asa = await member({ grants: [{ role: "ASA" }] });
    const w = await waiting(undefined, ids.bdk);
    expect(await addToRoster(recordingCourier(), asa.by, { memberId: w.id, campId: ids.bdk, rank: "PTE", name: "NEW GUY", role: "ST SVC" })).toMatchObject({ ok: true });
  });
});

describe("Roster: add and edit", () => {
  const lastIn = async (campId: string) => Math.max(...(await db.select({ s: person.sortOrder }).from(person).where(eq(person.campId, campId))).map((r) => r.s));
  const row = async (id: string) => (await db.select().from(person).where(eq(person.id, id)))[0];

  it("a GC adds a man to his own camp, at its end, and nowhere else", async (ctx) => {
    if (!reachable) ctx.skip();
    const gc = await member({ personId: slr[0].id, grants: [{ role: "GC", campId: ids.slr }] });
    const res = await addPersonToRoster(gc.by, { campId: ids.slr, rank: "pte", name: " fresh   man ", role: "ST SVC" });
    expect(res).toMatchObject({ ok: true, value: { label: "PTE FRESH MAN" } });
    if (!res.ok) return;
    const p = await row(res.value.personId);
    expect(p).toMatchObject({ campId: ids.slr, rank: "PTE", name: "FRESH MAN", role: "ST SVC", active: true });
    expect(p.sortOrder).toBe(await lastIn(ids.slr));
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, "create-person"), eq(auditLog.entityId, p.id))))[0].userId).toBe(PROJECTOR_USER.id);
    expect(await auditActions()).toEqual(["roster-add"]);
    expect(await db.select().from(wbMember).where(eq(wbMember.personId, p.id))).toEqual([]);

    const base = { campId: ids.slr, rank: "PTE", name: "OTHER MAN", role: "ST SVC" };
    expect(await addPersonToRoster(gc.by, { ...base, campId: ids.bdk })).toEqual({ ok: false, error: "BDK isn't in your platoon or camp." });
    const [srfA] = await db.select().from(camp).where(eq(camp.name, "SRF A"));
    expect(await addPersonToRoster(gc.by, { ...base, campId: srfA.id })).toEqual({ ok: false, error: "SRF A isn't in your platoon or camp." });
    expect(await addPersonToRoster(gc.by, { ...base, name: slr[3].name })).toEqual({
      ok: false,
      error: `There's already a ${slr[3].rank} ${slr[3].name} in SLR. Add a surname to tell them apart.`,
    });
    expect(await addPersonToRoster(gc.by, { ...base, rank: "GEN" })).toEqual({ ok: false, error: "Pick his rank." });
    expect(await auditActions()).toEqual(["roster-add"]);
  });

  it("a GC edits his own men but can't move them out; his PS moves one within the platoon, to the end", async (ctx) => {
    if (!reachable) ctx.skip();
    const gc = await member({ personId: slr[0].id, grants: [{ role: "GC", campId: ids.slr }] });
    const ps = await member({ grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const [srfA] = await db.select().from(camp).where(eq(camp.name, "SRF A"));
    const man = slr[2];
    const edit = { campId: ids.slr, rank: "CPL", name: `${man.name} TAN`, role: "ST CBT" };

    expect(await editRosterPerson(gc.by, man.id, edit)).toEqual({ ok: true, value: { changed: true, moved: false, label: `CPL ${man.name} TAN`, campName: "SLR" } });
    expect(await row(man.id)).toMatchObject({ campId: ids.slr, rank: "CPL", name: `${man.name} TAN`, role: "ST CBT" });
    const [audit] = await db.select().from(wbAudit).where(eq(wbAudit.action, "roster-edit"));
    expect(audit).toMatchObject({ memberId: gc.id, entityId: man.id, before: { rank: man.rank, name: man.name, role: "" }, after: edit });

    expect(await editRosterPerson(gc.by, bdk[1].id, { ...edit, campId: ids.bdk })).toEqual({ ok: false, error: `${bdk[1].rank} ${bdk[1].name} isn't in your platoon or camp.` });
    expect(await editRosterPerson(gc.by, man.id, { ...edit, campId: srfA.id })).toEqual({ ok: false, error: "SRF A isn't in your platoon or camp." });
    expect((await row(man.id)).campId).toBe(ids.slr);

    expect(await editRosterPerson(ps.by, man.id, { ...edit, campId: srfA.id })).toMatchObject({ ok: true, value: { moved: true, campName: "SRF A" } });
    const moved = await row(man.id);
    expect(moved.campId).toBe(srfA.id);
    expect(moved.sortOrder).toBe(await lastIn(srfA.id));
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, "update-person"), eq(auditLog.entityId, man.id)))).map((r) => r.userId)).toEqual([PROJECTOR_USER.id, PROJECTOR_USER.id]);
  });

  it("keeps v1's own rank and role unless they're changed; refuses a wrong role, a duplicate and a man off the roster", async (ctx) => {
    if (!reachable) ctx.skip();
    const ps = await member({ grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const man = slr[1];
    await db.update(person).set({ rank: "SCT", role: "GUARD COMM" }).where(eq(person.id, man.id));
    const base = { campId: ids.slr, rank: "SCT", name: man.name, role: "GUARD COMM" };

    // nothing changed: nothing written
    expect(await editRosterPerson(ps.by, man.id, base)).toMatchObject({ ok: true, value: { changed: false } });
    expect(await auditActions()).toEqual([]);
    // a rename keeps the old rank and role as v1 has them
    expect(await editRosterPerson(ps.by, man.id, { ...base, name: `${man.name} B` })).toMatchObject({ ok: true, value: { changed: true } });
    expect(await row(man.id)).toMatchObject({ rank: "SCT", role: "GUARD COMM", name: `${man.name} B` });
    // a blank role, left alone, stays blank
    expect(await editRosterPerson(ps.by, slr[5].id, { campId: ids.slr, rank: "CPL", name: slr[5].name, role: "" })).toMatchObject({ ok: true });
    expect(await row(slr[5].id)).toMatchObject({ rank: "CPL", role: "" });

    expect(await editRosterPerson(ps.by, man.id, { ...base, role: "PS" })).toEqual({ ok: false, error: "Pick a role that fits that camp." });
    expect(await editRosterPerson(ps.by, man.id, { ...base, rank: "GEN" })).toEqual({ ok: false, error: "Pick his rank." });
    expect(await editRosterPerson(ps.by, man.id, { ...base, name: slr[3].name })).toEqual({
      ok: false,
      error: `There's already a ${slr[3].rank} ${slr[3].name} in SLR. Add a surname to tell them apart.`,
    });
    await db.update(person).set({ active: false }).where(eq(person.id, slr[4].id));
    expect(await editRosterPerson(ps.by, slr[4].id, { ...base, name: slr[4].name })).toEqual({ ok: false, error: "He's no longer on the roster." });
  });

  it("a GC adds a waiting account from his camp, and his badge counts it", async (ctx) => {
    if (!reachable) ctx.skip();
    const gc = await member({ personId: slr[0].id, grants: [{ role: "GC", campId: ids.slr }] });
    const w = await member({ self: { name: "NEW GUY", rank: "PTE", role: "ST CBT", campId: ids.slr } });
    await member({ self: { name: "BDK GUY", rank: "PTE", role: "ST CBT", campId: ids.bdk } });
    expect(await waitingCount(gc.grants)).toBe(1);
    expect(await addToRoster(recordingCourier(), gc.by, { memberId: w.id, campId: ids.slr, rank: "PTE", name: "NEW GUY", role: "ST CBT" })).toMatchObject({ ok: true });
    expect(await waitingCount(gc.grants)).toBe(0);
  });
});

describe("Link to existing", () => {
  it("links him to an unregistered person in his camp and DMs him; refuses scope, a taken person and a linked account", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = recordingCourier();
    const ps = await member({ personId: slr[0].id, grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const pl7 = await member({ personId: bdk[0].id, grants: [{ role: "PS", subunitId: ids.pl7 }] });
    const w = await member({ self: { name: slr[5].name.split(" ")[0], rank: "PTE", role: "ST CBT", campId: ids.slr } });
    expect(await linkToRoster(c, pl7.by, w.id, slr[5].id)).toEqual({ ok: false, error: "He isn't in your platoon or camp." });
    expect(await linkToRoster(c, ps.by, w.id, bdk[1].id)).toMatchObject({ ok: false, error: `${bdk[1].rank} ${bdk[1].name} isn't in your platoon or camp.` });
    expect(await linkToRoster(c, ps.by, w.id, slr[0].id)).toEqual({ ok: false, error: "Someone else is already registered as that person." });
    expect(c.sent).toEqual([]);

    expect(await linkToRoster(c, ps.by, w.id, slr[5].id)).toEqual({ ok: true, value: { label: `${slr[5].rank} ${slr[5].name}` } });
    expect((await db.select().from(wbMember).where(eq(wbMember.id, w.id)))[0]).toMatchObject({ personId: slr[5].id, source: "ROSTER" });
    expect(c.sent).toHaveLength(1);
    expect(await linkToRoster(c, ps.by, w.id, slr[6].id)).toEqual({ ok: false, error: "Someone has just added him." });
  });
});

describe("waiting accounts: the badge, the evening line, the guard", () => {
  it("counts by Gaps scope, only unlinked, registered and active", async (ctx) => {
    if (!reachable) ctx.skip();
    await member({ self: { name: "A", rank: "PTE", role: "ST CBT", campId: ids.slr } });
    await member({ self: { name: "B", rank: "PTE", role: "ST CBT", campId: ids.bdk } });
    await member({ personId: slr[2].id });
    const off = await member({ self: { name: "C", rank: "PTE", role: "ST CBT", campId: ids.slr } });
    await db.update(wbMember).set({ active: false }).where(eq(wbMember.id, off.id));
    expect(await waitingCount([{ role: "PS", subunitId: ids.pl6, campId: null }])).toBe(1);
    expect(await waitingCount([{ role: "OC", subunitId: null, campId: null }])).toBe(2);
    expect(await waitingCount([{ role: "ASA", subunitId: null, campId: ids.bdk }])).toBe(1);
    expect(await waitingCount([{ role: "GC", subunitId: null, campId: null }])).toBe(0);
  });

  it("the evening line counts only those waiting more than 24 hours, in their own platoon's digest", async (ctx) => {
    if (!reachable) ctx.skip();
    const now = new Date();
    await member({ self: { name: "A", rank: "PTE", role: "ST CBT", campId: ids.slr }, registeredAt: new Date(now.getTime() - 25 * HOUR) });
    await member({ self: { name: "B", rank: "PTE", role: "ST CBT", campId: ids.slr }, registeredAt: new Date(now.getTime() - 23 * HOUR) });
    await member({ self: { name: "C", rank: "PTE", role: "ST CBT", campId: ids.bdk }, registeredAt: new Date(now.getTime() - 30 * HOUR) });
    expect(await waitingByPlatoon(new Date(now.getTime() - 24 * HOUR))).toEqual([
      { subunitId: ids.pl6, subunitName: "PLATOON 6", n: 1 },
      { subunitId: ids.pl7, subunitName: "PLATOON 7", n: 1 },
    ]);
    const c = recordingCourier();
    const summary = await eveningRound(c, now, { force: true });
    expect(summary.waiting).toBe(2);
    const pl6 = c.sent.find((s) => "send" in s && "platoon" in s.send && s.send.platoon === ids.pl6) as { text: string; buttons?: unknown };
    expect(pl6.text).toContain("👤 1 man waiting to be added to the roster");
    expect(pl6.buttons).toEqual([[{ text: "Open Roster", route: "roster" }]]);
    expect(c.sent.some((s) => "send" in s && "platoon" in s.send && s.send.platoon === ids.hq)).toBe(false);
  });

  it("an unlinked account with no grant is sent to the waiting screen; with a grant or a roster person it isn't; register stays reachable", async (ctx) => {
    if (!reachable) ctx.skip();
    const w = await member({ self: { name: "A", rank: "PTE", role: "ST CBT", campId: ids.slr } });
    await signIn({ id: w.telegramUserId, first_name: "T" });
    await expect(requireRegistered()).rejects.toThrow("REDIRECT /tg/waiting");
    expect((await requireMember()).id).toBe(w.id); // what /tg/register and /tg/waiting use

    jar.clear();
    const admin = await member({ grants: [{ role: "ADMIN" }] });
    await signIn({ id: admin.telegramUserId, first_name: "T" });
    expect((await requireRegistered()).id).toBe(admin.id);

    jar.clear();
    const trooper = await member({ personId: slr[2].id });
    await signIn({ id: trooper.telegramUserId, first_name: "T" });
    expect((await requireRegistered()).id).toBe(trooper.id);
  });

  it("a switched-off account is told so at sign-in instead of signing in to nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("WB_BOT_TOKEN", TEST_BOT_TOKEN);
    const m = await member({ personId: slr[2].id });
    const signInWith = () =>
      authRoute(new Request("http://localhost/api/wb/auth", { method: "POST", body: JSON.stringify({ initData: signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: tgUser(m.telegramUserId) }) }) }));
    expect((await signInWith()).status).toBe(200);
    await db.update(wbMember).set({ active: false }).where(eq(wbMember.id, m.id));
    const res = await signInWith();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Your Sabre account is switched off. Ask your PS." });
  });
});

describe("stay-out from Person history (2026-10-27)", () => {
  it("his PC or PS, or company command, changes it; not his GC; not a man who hasn't registered", async (ctx) => {
    if (!reachable) ctx.skip();
    const { setStayout } = await import("@/lib/wb/stayout");
    const { rosterFor } = await import("@/lib/wb/admin-data");
    const man = await member({ personId: slr[2].id });
    const gc = await member({ personId: slr[0].id, grants: [{ role: "GC", campId: ids.slr }] });
    const ps = await member({ grants: [{ role: "PS", subunitId: ids.pl6 }] });
    const otherPs = await member({ grants: [{ role: "PS", subunitId: ids.pl7 }] });
    const admin = await member({ grants: [{ role: "ADMIN" }] });
    const label = `${slr[2].rank} ${slr[2].name}`;
    const now = new Date("2026-10-27T04:00:00Z");

    expect(await setStayout(gc.by, slr[2].id, { stayout: "PERM", until: null }, now)).toEqual({
      ok: false,
      error: `Only ${label}'s PC or PS, or the OC, 2IC or CSM, can change his stay-out.`,
    });
    expect((await setStayout(otherPs.by, slr[2].id, { stayout: "PERM", until: null }, now)).ok).toBe(false);
    expect(await setStayout(ps.by, slr[2].id, { stayout: "TEMP", until: "2026-10-26" }, now)).toEqual({ ok: false, error: "The last day of his stay-out can't be in the past." });
    expect(await setStayout(ps.by, slr[2].id, { stayout: "TEMP", until: "2026-10-31" }, now)).toEqual({ ok: true, value: { label } });
    expect((await db.select().from(wbMember).where(eq(wbMember.id, man.id)))[0]).toMatchObject({ stayout: "TEMP", stayoutUntil: "2026-10-31" });
    const [a] = await db.select().from(wbAudit).where(eq(wbAudit.action, "set-stayout"));
    expect(a).toMatchObject({ memberId: ps.id, entityId: man.id, before: { stayout: "NONE", stayoutUntil: null }, after: { stayout: "TEMP", stayoutUntil: "2026-10-31" } });

    // Roster's filter
    const roster = await rosterFor(ps.grants);
    const flagged = roster.camps.flatMap((c) => c.people.filter((p) => p.stayout).map((p) => p.personId));
    expect(flagged).toEqual([slr[2].id]);

    expect((await setStayout(admin.by, slr[2].id, { stayout: "NONE", until: "2026-10-31" }, now)).ok).toBe(true);
    expect((await db.select().from(wbMember).where(eq(wbMember.id, man.id)))[0]).toMatchObject({ stayout: "NONE", stayoutUntil: null });
    expect(await setStayout(ps.by, slr[3].id, { stayout: "PERM", until: null }, now)).toEqual({
      ok: false,
      error: `${slr[3].rank} ${slr[3].name} hasn't registered, so Sabre can't keep his stay-out yet.`,
    });
  });
});
