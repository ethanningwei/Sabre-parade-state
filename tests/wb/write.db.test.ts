// The Write (lib/wb/write.ts) through the database: a refusal (or v1's
// UserError) rolls the whole change back and tells nobody; an unregistered
// member is refused before anything runs; every audit row says who and
// through what; a write that touches the parade state brings it in line
// before the Courier is told, one that doesn't leaves it alone; and joining a
// caller's transaction (v1's Admin › Remove) syncs and tells only once the
// caller calls finish. Uses sabre_test; skipped if unreachable.

import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { removePersonCore } from "@/lib/core/people";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { absence, auditLog, camp, person, user } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { Refusal } from "@/lib/wb/core";
import { wbAssignment, wbAudit, wbGrant, wbMember, wbProjection, wbRecord, wbShiftEvent, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import { removeFromWhereabouts } from "@/lib/wb/roster-flow";
import { joinWrite, write, type By } from "@/lib/wb/write";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, member, reachable as dbUp } from "./writes";

const V1_ADMIN = "write-test-v1-admin";
let reachable = true;
let tft: string[] = [];

beforeAll(async () => {
  reachable = await dbUp();
});
beforeEach(async () => {
  if (!reachable) return;
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("FEATURE_PROJECTION", "");
  await db.delete(wbProjection);
  await db.delete(wbAssignment);
  await db.delete(wbShiftEvent);
  await db.delete(wbShiftOverride);
  await db.delete(wbShiftPattern);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  const [c] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "TFT"));
  tft = (await db.select({ id: person.id }).from(person).where(and(eq(person.campId, c.id), eq(person.active, true))).orderBy(person.sortOrder)).map((r) => r.id);
  // kept between runs: what it closed in v1 still names it
  await db.insert(user).values({ id: V1_ADMIN, name: "write test v1 admin", role: "admin" }).onConflictDoNothing();
});
afterAll(async () => {
  if (reachable) {
    await db.delete(wbProjection);
    await db.delete(wbRecord);
    await db.delete(wbAudit);
    await db.delete(wbGrant);
    await db.delete(wbMember);
    await db.delete(auditLog).where(eq(auditLog.userId, V1_ADMIN));
  }
  vi.unstubAllEnvs();
  await db.$client.end();
});

const SYSTEM: By = { system: "SYSTEM" };
const audits = () => db.select({ action: wbAudit.action, memberId: wbAudit.memberId, via: wbAudit.via, after: wbAudit.after }).from(wbAudit).orderBy(wbAudit.at);
const openAbsence = async (personId: string) => (await db.select().from(absence).where(and(eq(absence.personId, personId), isNull(absence.closedAt))))[0];
/** An approved AL in force right now: the next sync puts it on the parade state. */
const leaveNow = (personId: string) =>
  db.insert(wbRecord).values({ personId, kind: "AL", detail: "AL", state: "APPROVED", absent: true, startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000), createdVia: "SELF" });

describe("a refused write", () => {
  it("a Refusal anywhere in the change rolls it all back, comes back as the message, and tells nobody", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = recordingCourier();
    const tell = vi.fn(async () => "told");
    const res = await write(c, SYSTEM, {
      parade: false,
      async change({ audit }) {
        await audit({ action: "first", entity: "test" });
        throw new Refusal("Not today.");
      },
      tell,
    });
    expect(res).toEqual({ ok: false, error: "Not today." });
    expect(await audits()).toEqual([]);
    expect(tell).not.toHaveBeenCalled();
    expect(c.sent).toEqual([]);
  });

  it("so is a v1 UserError from lib/core; anything else is thrown", async (ctx) => {
    if (!reachable) ctx.skip();
    const change = (e: Error) => async () => {
      throw e;
    };
    expect(await write(null, SYSTEM, { parade: false, change: change(new UserError("Duplicate name.")) })).toEqual({ ok: false, error: "Duplicate name." });
    await expect(write(null, SYSTEM, { parade: false, change: change(new Error("boom")) })).rejects.toThrow("boom");
  });

  it("an unregistered member is refused before anything runs; registration is the one write he may make", async (ctx) => {
    if (!reachable) ctx.skip();
    await member(1, null, [], { registeredAt: null });
    const change = vi.fn(async () => "done");
    expect(await write(null, await acting(1, "MINIAPP"), { parade: false, change })).toEqual({ ok: false, error: "Register first." });
    expect(await write(null, await acting(1, "BOT"), { parade: false, change })).toEqual({ ok: false, error: "Open Sabre and register first." });
    expect(change).not.toHaveBeenCalled();
    expect(await write(null, await acting(1), { parade: false, unregistered: true, change })).toEqual({ ok: true, value: "done" });
  });
});

describe("a committed write", () => {
  it("fills every audit row with who and through what", async (ctx) => {
    if (!reachable) ctx.skip();
    const m = await member(1, null);
    const row = (action: string) => ({ action, entity: "test", after: { n: 1 } });
    await write(null, await acting(1, "BOT"), { parade: false, change: ({ audit }) => audit(row("bot")) });
    await write(null, { system: "WEB", label: "v1 test admin" }, { parade: false, change: ({ audit }) => audit(row("web")) });
    await write(null, SYSTEM, { parade: false, change: ({ audit }) => audit(row("evening")) });
    expect(await audits()).toEqual([
      { action: "bot", memberId: m.id, via: "BOT", after: { n: 1 } },
      { action: "web", memberId: null, via: "WEB", after: { n: 1, by: "v1 test admin" } },
      { action: "evening", memberId: null, via: "SYSTEM", after: { n: 1 } },
    ]);
  });

  it("parade: true brings the parade state in line before the Courier is told; parade: false leaves it", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("FEATURE_PROJECTION", "1");
    await leaveNow(tft[0]);
    expect(await write(null, SYSTEM, { parade: false, change: async () => null })).toEqual({ ok: true, value: null });
    expect(await openAbsence(tft[0])).toBeUndefined();

    const c = recordingCourier();
    const res = await write(c, SYSTEM, {
      parade: true,
      change: async () => tft[0],
      async tell(personId) {
        return (await openAbsence(personId))?.type ?? "not yet";
      },
    });
    expect(res).toEqual({ ok: true, value: "AL" });
  });

  it("with projection off, parade: true writes nothing to v1", async (ctx) => {
    if (!reachable) ctx.skip();
    await leaveNow(tft[0]);
    await write(null, SYSTEM, { parade: true, change: async () => null });
    expect(await openAbsence(tft[0])).toBeUndefined();
  });
});

describe("joining a caller's transaction", () => {
  it("a refusal is thrown to the caller, whose transaction rolls back", async (ctx) => {
    if (!reachable) ctx.skip();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(wbAudit).values({ memberId: null, via: "WEB", action: "caller", entity: "test" });
        await joinWrite(tx, async () => recordingCourier(), SYSTEM, {
          parade: false,
          change: async () => {
            throw new Refusal("No.");
          },
        });
      }),
    ).rejects.toThrow("No.");
    expect(await audits()).toEqual([]);
  });

  it("v1's Admin › Remove: syncs and redraws only once v1 has committed", async (ctx) => {
    if (!reachable) ctx.skip();
    vi.stubEnv("FEATURE_PROJECTION", "1");
    await leaveNow(tft[1]); // someone else's leave, waiting for a sync
    const deliver = await db.transaction(async (tx) => {
      await removePersonCore(tx, V1_ADMIN, tft[0]);
      const d = await removeFromWhereabouts(tx, tft[0], { v1UserId: V1_ADMIN, v1Name: "v1 test admin" });
      expect(await openAbsence(tft[1])).toBeUndefined();
      return d;
    });
    expect(await openAbsence(tft[1])).toBeUndefined();
    await deliver();
    expect(await openAbsence(tft[1])).toMatchObject({ type: "AL" });
    expect((await db.select().from(person).where(eq(person.id, tft[0])))[0].active).toBe(false);
  });
});
