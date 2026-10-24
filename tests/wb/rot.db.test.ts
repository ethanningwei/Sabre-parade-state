// ROT through the database: the phase read, the parade state by phase, and
// the changeover's draft (who may, platoons and sections, placing men, SCs,
// PCs and PSes, the pasted list). Uses sabre_test; skipped if unreachable.

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { writeCoy } from "@/lib/data/write-coy";
import { renderParadeState } from "@/lib/parade";
import { db } from "@/lib/db";
import { absence, auditLog, camp, coy, duty, person, subunit } from "@/lib/db/schema";
import { wbAssignment, wbAudit, wbCard, wbChangeover, wbDraftPlatoon, wbGrant, wbMember, wbPhase, wbProjection, wbRecord, wbRfRequest } from "@/lib/wb/db/schema";
import { emptyLog } from "@/lib/wb/domain/rot";
import { phaseOf, phaseState } from "@/lib/wb/phase";
import { paradeView } from "@/lib/wb/rot-parade";
import { EXAMPLE_CAA, exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, member, ok } from "./writes";

const { addPlatoon, addSection, assignPasted, placeCamp, placeMen, removeSection, setCommander, unplaceMen } = await import("@/lib/wb/changeover");
const { checkPaste, checklist, loadDraft, preview } = await import("@/lib/wb/changeover-data");
const { switchBack, switchToRot } = await import("@/lib/wb/switch");
const { addPersonToRoster } = await import("@/lib/wb/roster-flow");
const { rosterFor } = await import("@/lib/wb/admin-data");
const { eveningRound } = await import("@/lib/wb/evening");
const { currentPhase } = await import("@/lib/wb/phase");

/** Active people of a camp, in roster order. */
async function peopleOf(campName: string) {
  return db
    .select({ id: person.id, rank: person.rank, name: person.name })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .where(and(eq(camp.name, campName), eq(person.active, true)))
    .orderBy(asc(person.sortOrder));
}
const campIdOf = async (name: string) => (await db.select({ id: camp.id }).from(camp).where(eq(camp.name, name)))[0].id;
const refused = (res: { ok: boolean; error?: string }) => (res.ok ? "" : res.error!);

let reachable = true;
let coyId = "";

async function cleanRot() {
  await db.delete(wbPhase);
  await db.delete(wbChangeover);
  await db.delete(wbDraftPlatoon);
  await db.delete(wbCard);
  await db.delete(wbProjection);
  await db.delete(wbAssignment);
  await db.delete(wbRfRequest);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
  // the switch's moves are v1 writes as the projector; people outlive each file, so would their v1 audit
  await db.delete(auditLog).where(eq(auditLog.userId, "wb-projector"));
}

/** The fixture's coy exactly: a switch left half done must not leave its platoons and sections behind for the next file. */
async function resetCoy() {
  const fixture = exampleSnapshot();
  const [c] = await db.select({ id: coy.id }).from(coy).where(eq(coy.key, "SABRE"));
  if (c) {
    const camps = fixture.subunits.flatMap((s) => s.camps.map((x) => x.name));
    const extra = await db.select({ id: camp.id }).from(camp).where(and(eq(camp.coyId, c.id), notInArray(camp.name, camps)));
    if (extra.length) {
      await db.delete(duty).where(inArray(duty.campId, extra.map((x) => x.id)));
      await db.delete(person).where(inArray(person.campId, extra.map((x) => x.id)));
      await db.delete(camp).where(inArray(camp.id, extra.map((x) => x.id)));
    }
    await db.delete(subunit).where(and(eq(subunit.coyId, c.id), notInArray(subunit.name, fixture.subunits.map((s) => s.name))));
  }
  await writeCoy(db, { ...fixture, telegram: { chatId: null, threadId: null } });
  return (await db.select({ id: coy.id }).from(coy).where(eq(coy.key, "SABRE")))[0].id;
}

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
  }
});
beforeEach(async () => {
  if (!reachable) return;
  await cleanRot();
  coyId = await resetCoy();
});
afterAll(async () => {
  if (!reachable) return;
  await cleanRot();
  await resetCoy();
});

describe("the phase (DB)", () => {
  it("is Vigilance with no row, and ROT once a switch is recorded", async () => {
    if (!reachable) return;
    expect(await phaseOf(coyId)).toBe("VIGILANCE");
    const [c] = await db.insert(wbChangeover).values({ coyId, to: "ROT", log: emptyLog() }).returning();
    await db.insert(wbPhase).values({ coyId, phase: "ROT", changeoverId: c.id });
    const s = await phaseState(coyId);
    expect(s.phase).toBe("ROT");
    expect(s.changeover?.id).toBe(c.id);
    expect(s.changeover?.log.hiddenCamps).toEqual([]);
    await db.update(wbPhase).set({ phase: "VIGILANCE", changeoverId: null });
    expect(await phaseState(coyId)).toEqual({ phase: "VIGILANCE", changeover: null });
  });
});

describe("the parade state by phase (DB)", () => {
  it("is Vigilance's with FEATURE_WHEREABOUTS off, whatever wb_phase says; ROT's with it on", async () => {
    if (!reachable) return;
    const [coyRow] = await db.select().from(coy).where(eq(coy.id, coyId));
    const snapshot = await loadSnapshot(coyRow);
    const vigilance = renderParadeState(snapshot, EXAMPLE_CAA);
    const slr = snapshot.subunits.flatMap((s) => s.camps).find((c) => c.name === "SLR")!;
    const [c] = await db.insert(wbChangeover).values({ coyId, to: "ROT", log: { ...emptyLog(), hiddenCamps: [slr.id] } }).returning();
    await db.insert(wbPhase).values({ coyId, phase: "ROT", changeoverId: c.id });

    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    const off = await paradeView(coyId, snapshot);
    expect(off.phase).toBe("VIGILANCE");
    expect(off.snapshot).toBe(snapshot);
    expect(off.render(EXAMPLE_CAA)).toBe(vigilance);

    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    const on = await paradeView(coyId, snapshot);
    expect(on.phase).toBe("ROT");
    expect(on.snapshot.subunits.flatMap((s) => s.camps).some((c) => c.id === slr.id)).toBe(false);
    expect(on.render(EXAMPLE_CAA)).not.toContain("Off Shift");
    vi.unstubAllEnvs();
  });
});

describe("the changeover draft (DB)", () => {
  // 1: an ASA in COY HQ; 2: SLR's GC (not COY HQ); 3: an admin outside COY HQ
  async function people() {
    const hq = await peopleOf("COY HQ");
    const slr = await peopleOf("SLR");
    await member(1, hq[0].id, [g("ASA")]);
    await member(2, slr[0].id, [{ role: "GC", campId: await campIdOf("SLR") }]);
    await member(3, null, [g("ADMIN")]);
    return { hq, slr };
  }
  const g = (role: "ASA" | "ADMIN") => ({ role });

  it("is COY HQ's and the admins' to work on, and only in Vigilance", async () => {
    if (!reachable) return;
    await people();
    expect(refused(await addPlatoon(await acting(2), "PLATOON 1"))).toMatch(/Only COY HQ and admins/);
    expect(ok(await addPlatoon(await acting(1), " platoon  1 ")).name).toBe("PLATOON 1");
    expect(ok(await addPlatoon(await acting(3), "PLATOON 2")).name).toBe("PLATOON 2");
    expect(refused(await addPlatoon(await acting(1), "Platoon 1"))).toMatch(/in the draft already/);
    expect(refused(await addPlatoon(await acting(1), "COY HQ"))).toMatch(/stays as it is/);
    await db.insert(wbPhase).values({ coyId, phase: "ROT" });
    expect(refused(await addPlatoon(await acting(1), "PLATOON 3"))).toMatch(/in ROT already/);
  });

  it("sections, placing men, SCs, PCs and PSes; the checklist and the preview", async () => {
    if (!reachable) return;
    const { hq, slr } = await people();
    const as = await acting(1);
    const p1 = ok(await addPlatoon(as, "PLATOON 1"));
    const s1 = ok(await addSection(as, p1.id));
    const s2 = ok(await addSection(as, p1.id));
    expect([s1.name, s2.name]).toEqual(["SECTION 1", "SECTION 2"]);

    // COY HQ and SVC troopers aren't placed
    expect(refused(await placeMen(as, [hq[1].id], s1.id))).toMatch(/is in COY HQ/);
    await db.update(person).set({ role: "SVC" }).where(eq(person.id, slr[1].id));
    expect(refused(await placeMen(as, [slr[1].id], s1.id))).toMatch(/SVC trooper/);

    expect(ok(await placeMen(as, [slr[0].id, slr[2].id], s1.id)).placed).toBe(2);
    // "Move all of SLR here": the rest of SLR's combat troopers, not the SVC trooper, not those placed
    const moved = ok(await placeCamp(as, await campIdOf("SLR"), s2.id));
    expect(moved.placed).toBe(slr.length - 3);

    // an SC must be in his section; moving him out drops it
    expect(refused(await setCommander(as, { role: "SC", scopeId: s2.id, personId: slr[0].id }))).toMatch(/Place him in this section first/);
    ok(await setCommander(as, { role: "SC", scopeId: s1.id, personId: slr[0].id }));
    expect(refused(await setCommander(as, { role: "PC", scopeId: p1.id, personId: slr[3].id }))).toMatch(/from COY HQ/);
    ok(await setCommander(as, { role: "PC", scopeId: p1.id, personId: hq[1].id }));
    ok(await setCommander(as, { role: "PS", scopeId: p1.id, personId: hq[2].id }));
    ok(await setCommander(as, { role: "PS", scopeId: p1.id, personId: hq[3].id }));

    let d = await loadDraft();
    expect(d.platoons[0].sections[0].sc?.personId).toBe(slr[0].id);
    expect(d.platoons[0].ps.map((p) => p.personId)).toEqual([hq[2].id, hq[3].id]);
    expect(d.platoons[0].pc?.registered).toBe(false);
    const c = checklist(d);
    expect(c).toMatchObject({ platoons: 1, sections: 2, placed: slr.length - 1, sectionsWithSc: 1, platoonsWithPcPs: 1, svc: 1, ready: false });
    expect(c.blockers.join(" ")).toMatch(/men still need a section/);

    const pv = preview(d);
    expect(pv.text).toContain(`PLATOON 1\n• Total strength: ${slr.length - 1}\n`);
    expect(pv.text).toMatch(/SECTION 1\n• Total Strength: 02\n/);
    expect(pv.unplaced).toBe(c.toPlace - c.placed);

    ok(await placeMen(as, [slr[0].id], s2.id));
    d = await loadDraft();
    expect(d.platoons[0].sections[0].sc).toBeNull();

    // deleting a section puts its men back
    expect(ok(await removeSection(as, s2.id)).unplaced).toBe(slr.length - 2);
    ok(await unplaceMen(as, [slr[2].id]));
    expect(checklist(await loadDraft()).placed).toBe(0);
  });

  it("the pasted list: matched, not sure, not on the roster; assigning drafts the sections it names", async () => {
    if (!reachable) return;
    const { slr } = await people();
    const as = await acting(1);
    await db.update(person).set({ role: "SVC" }).where(eq(person.id, slr[4].id));
    const text = ["PLATOON 1", "Section 1", `1. ${slr[0].rank} ${slr[0].name} (SC)`, `2. ${slr[2].name}`, "3. PTE NOBODY HERE", "Section 2", `1. ${slr[3].name}`, `2. ${slr[4].name}`, "3. SLR PRESENT", "4. 3SG RUI HENG"].join("\n");
    const check = checkPaste(await loadDraft(), text);
    expect(check.read).toBe(7);
    expect(check.matched.map((m) => [m.person.personId, m.section, m.sc])).toEqual([
      [slr[0].id, "SECTION 1", true],
      [slr[2].id, "SECTION 1", false],
      [slr[3].id, "SECTION 2", false],
    ]);
    expect(check.missing.map((m) => m.raw)).toEqual(["3. PTE NOBODY HERE"]);
    expect(check.unsure[0].tooMany).toBeGreaterThan(6); // "SLR PRESENT" names a dozen men
    expect(check.skipped.map((s) => s.why)).toEqual(["svc", "hq"]);
    expect(check.newStructure).toEqual(["PLATOON 1", "PLATOON 1 SECTION 1", "PLATOON 1 SECTION 2"]);

    const res = ok(await assignPasted(as, check.matched.map((m) => ({ personId: m.person.personId, platoon: m.platoon, section: m.section, sc: m.sc }))));
    expect(res).toMatchObject({ placed: 3, created: ["PLATOON 1", "PLATOON 1 SECTION 1", "PLATOON 1 SECTION 2"] });
    let d = await loadDraft();
    expect(d.platoons[0].sections.map((s) => [s.name, s.men.length, s.sc?.personId ?? null])).toEqual([
      ["SECTION 1", 2, slr[0].id],
      ["SECTION 2", 1, null],
    ]);

    // a later paste only changes the men it names
    ok(await assignPasted(as, [{ personId: slr[3].id, platoon: "PLATOON 2", section: "SECTION 1", sc: false }]));
    d = await loadDraft();
    expect(d.platoons.map((p) => [p.name, p.sections.map((s) => s.men.map((m) => m.personId))])).toEqual([
      ["PLATOON 1", [[slr[0].id, slr[2].id], []]],
      ["PLATOON 2", [[slr[3].id]]],
    ]);
    expect(refused(await assignPasted(as, [{ personId: slr[4].id, platoon: "PLATOON 1", section: "SECTION 1", sc: false }]))).toMatch(/SVC/);
  });
});

describe("Switch to ROT and Switch back (DB)", () => {
  const HOUR = 60 * 60 * 1000;

  it("switches: sections are v1 camps, SVC troopers off, GC and platoon PC/PS grants replaced; Switch back puts the Vigilance parade state back byte for byte", async () => {
    if (!reachable) return;
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    const now = new Date();
    const hq = await peopleOf("COY HQ");
    const slr = await peopleOf("SLR");
    const subOf = async (name: string) => (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, name)))[0].id;
    // SLR's last two are SVC troopers; one has an account, a PS grant (of all things), an MC and a pending request
    const [svc1, svc2] = slr.slice(-2);
    await db.update(person).set({ role: "SVC" }).where(inArray(person.id, [svc1.id, svc2.id]));
    await db.update(person).set({ role: "GUARD COMM" }).where(eq(person.id, slr[0].id));
    await member(1, hq[0].id, [{ role: "ASA" }]);
    const gc = await member(2, slr[0].id, [{ role: "GC", campId: await campIdOf("SLR") }]);
    const ps6 = await member(3, hq[1].id, [{ role: "PS", subunitId: await subOf("PLATOON 6") }]);
    const svcMember = await member(4, svc1.id, [{ role: "PS", subunitId: await subOf("PLATOON 7") }]);
    await member(5, hq[2].id, [{ role: "OC" }]);
    const [mc] = await db.insert(absence).values({ personId: svc1.id, type: "MC", startDate: "2026-10-20", endDate: "2099-01-01" }).returning();
    const [pending] = await db
      .insert(wbRecord)
      .values({ personId: svc1.id, kind: "AL", startAt: new Date(now.getTime() + 72 * HOUR), endAt: new Date(now.getTime() + 96 * HOUR), absent: true, state: "PENDING", createdVia: "SELF", leaveDays: 1 })
      .returning();
    // a combat trooper on an Extra at BDK, in Sabre and in v1
    const [asg] = await db.insert(wbAssignment).values({ personId: slr[1].id, type: "EXTRA", campId: await campIdOf("BDK"), startAt: new Date(now.getTime() - HOUR), endAt: new Date(now.getTime() + 48 * HOUR), state: "ACTIVE" }).returning();
    const [v1Duty] = await db.insert(duty).values({ coyId, type: "EXTRA", rank: slr[1].rank, name: slr[1].name, personId: slr[1].id, campId: await campIdOf("BDK"), startDate: "2026-10-20", endDate: "2099-01-01", sortOrder: 0 }).returning();

    const [coyRow] = await db.select().from(coy).where(eq(coy.id, coyId));
    const vigilance = renderParadeState(await loadSnapshot(coyRow), EXAMPLE_CAA);
    const grantsBefore = (await db.select({ memberId: wbGrant.memberId, role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant)).map((g) => JSON.stringify(g)).sort();

    // the draft: one ROT platoon per Vigilance platoon, one section per camp; SLR's GC its SC; a PC and a PS for PLATOON 1
    const as = await acting(1);
    const snapshot = await loadSnapshot(coyRow);
    let n = 0;
    for (const sub of snapshot.subunits.filter((x) => !x.isHq)) {
      // the second takes over Vigilance's PLATOON 6 by name
      const pl = ok(await addPlatoon(as, ++n === 2 ? "PLATOON 6" : `PLATOON ${n}`));
      for (const c of sub.camps) {
        const sec = ok(await addSection(as, pl.id, `SECTION ${c.name}`));
        ok(await placeCamp(as, c.id, sec.id));
        if (c.name === "SLR") ok(await setCommander(as, { role: "SC", scopeId: sec.id, personId: slr[0].id }));
      }
      if (n === 1) {
        ok(await setCommander(as, { role: "PC", scopeId: pl.id, personId: hq[3].id }));
        ok(await setCommander(as, { role: "PS", scopeId: pl.id, personId: hq[1].id }));
      }
    }
    expect(checklist(await loadDraft()).ready).toBe(true);

    // someone outside COY HQ can't switch
    expect(refused(await switchToRot(recordingCourier(), await acting(2), now))).toMatch(/Only COY HQ and admins/);

    const courier = recordingCourier();
    const res = ok(await switchToRot(courier, as, now));
    // ended: the Extra in Sabre, and every open v1 duty (the fixture's and ours)
    const v1Duties = (await db.select({ id: duty.id }).from(duty).where(eq(duty.coyId, coyId))).length;
    expect(res).toMatchObject({ platoons: 4, removed: 2, kept: [], grantsRemoved: 3, grantsAdded: 2, ended: 1 + v1Duties });
    expect(res.unregistered).toEqual([`${hq[3].rank} ${hq[3].name} (PC)`]);
    expect(await phaseOf(coyId)).toBe("ROT");

    // where the men are, and what v1's parade state prints
    const [slrMan] = await db.select({ camp: camp.name, role: person.role }).from(person).innerJoin(camp, eq(camp.id, person.campId)).where(eq(person.id, slr[0].id));
    expect(slrMan).toEqual({ camp: "PLATOON 6 SECTION SLR", role: "SC" });
    const rot = await paradeView(coyId, await loadSnapshot(coyRow));
    expect(rot.phase).toBe("ROT");
    const text = rot.render(EXAMPLE_CAA);
    // the draft's order, the reused PLATOON 6 included
    expect(text.split("\n").filter((l) => /^PLATOON \d: /.test(l)).map((l) => l.split(":")[0])).toEqual(["PLATOON 1", "PLATOON 6", "PLATOON 3", "PLATOON 4"]);
    expect(text).toContain("PLATOON 6\n• Total strength: ");
    expect(text).toContain("\nSECTION SLR\n• Total Strength: ");
    expect(text).not.toMatch(/Off Shift: (?!00)|PLATOON 5|Serving|\nSLR\n/);
    expect(text).not.toContain(svc1.name);

    // SVC troopers off, as ORD: account off, grants gone, request withdrawn, MC closed
    expect((await db.select({ active: person.active }).from(person).where(eq(person.id, svc1.id)))[0].active).toBe(false);
    expect((await db.select({ active: wbMember.active }).from(wbMember).where(eq(wbMember.id, svcMember.id)))[0].active).toBe(false);
    expect((await db.select({ state: wbRecord.state }).from(wbRecord).where(eq(wbRecord.id, pending.id)))[0].state).toBe("WITHDRAWN");
    expect(courier.sent).toContainEqual({ redraw: { record: pending.id } });
    // grants: the GC and the Vigilance platoons' PSes gone; SLR's SC and PLATOON 1's PS given (its PC has no account)
    const grants = await db.select({ memberId: wbGrant.memberId, role: wbGrant.role, campId: wbGrant.campId, subunitId: wbGrant.subunitId }).from(wbGrant);
    expect(grants.some((g) => g.role === "GC")).toBe(false);
    expect(grants.find((g) => g.memberId === gc.id)?.role).toBe("SC");
    expect(grants.find((g) => g.memberId === ps6.id)).toMatchObject({ role: "PS", subunitId: await subOf("PLATOON 1") });
    // the Extra ended
    expect((await db.select({ state: wbAssignment.state }).from(wbAssignment).where(eq(wbAssignment.id, asg.id)))[0].state).toBe("CANCELLED");
    expect((await db.select({ closedAt: duty.closedAt }).from(duty).where(eq(duty.id, v1Duty.id)))[0].closedAt).not.toBeNull();
    // the draft can't change now
    expect(refused(await addPlatoon(as, "PLATOON 9"))).toMatch(/in ROT already/);

    // Switch back
    const back = ok(await switchBack(recordingCourier(), as, new Date(now.getTime() + HOUR)));
    expect(back).toMatchObject({ moved: res.moved, restored: 2, notes: [] });
    expect(await phaseOf(coyId)).toBe("VIGILANCE");
    expect(renderParadeState(await loadSnapshot(coyRow), EXAMPLE_CAA)).toBe(vigilance);
    const grantsAfter = (await db.select({ memberId: wbGrant.memberId, role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId }).from(wbGrant)).map((g) => JSON.stringify(g)).sort();
    expect(grantsAfter).toEqual(grantsBefore);
    expect((await db.select({ state: wbRecord.state }).from(wbRecord).where(eq(wbRecord.id, pending.id)))[0].state).toBe("PENDING");
    expect((await db.select({ active: wbMember.active }).from(wbMember).where(eq(wbMember.id, svcMember.id)))[0].active).toBe(true);
    expect((await db.select({ closedAt: absence.closedAt }).from(absence).where(eq(absence.id, mc.id)))[0].closedAt).toBeNull();
    expect((await db.select({ state: wbAssignment.state }).from(wbAssignment).where(eq(wbAssignment.id, asg.id)))[0].state).toBe("ACTIVE");
    expect(await db.select().from(subunit).where(eq(subunit.name, "PLATOON 1"))).toEqual([]);
    // the draft is still there, for another go
    expect((await loadDraft()).platoons).toHaveLength(4);
    expect(refused(await switchBack(recordingCourier(), as))).toMatch(/isn't in ROT/);
    vi.unstubAllEnvs();
  });
});

describe("the Mini App in ROT (DB)", () => {
  it("Roster by section with SC/CBT, nobody into a hidden camp; the evening round sends no below-minimum or RF lines", async () => {
    if (!reachable) return;
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    const hq = await peopleOf("COY HQ");
    await member(1, hq[0].id, [{ role: "ASA" }]);
    await member(9, null, [{ role: "OC" }]);
    const as = await acting(1);
    const [coyRow] = await db.select().from(coy).where(eq(coy.id, coyId));
    let n = 0;
    for (const sub of (await loadSnapshot(coyRow)).subunits.filter((x) => !x.isHq)) {
      const pl = ok(await addPlatoon(as, `PLATOON ${++n}`));
      for (const c of sub.camps) ok(await placeCamp(as, c.id, ok(await addSection(as, pl.id, c.name)).id));
    }
    const slrCamp = await campIdOf("SLR");
    // an RF request open at a guardroom, and the evening round's "RF still open" line before the switch
    await db.insert(wbRfRequest).values({ campId: slrCamp, role: "ANY", need: 1, startAt: new Date(Date.now() + 3600e3), endAt: new Date(Date.now() + 48 * 3600e3), state: "OPEN" });
    ok(await switchToRot(recordingCourier(), as));

    const phase = await currentPhase();
    expect(phase.phase).toBe("ROT");
    expect(phase.hidden.has(slrCamp)).toBe(true);
    const roster = await rosterFor([{ role: "OC", subunitId: null, campId: null }], phase.hidden);
    expect(roster.camps.some((c) => c.id === slrCamp)).toBe(false);
    const section = await campIdOf("PLATOON 2 SLR");
    expect(roster.camps.find((c) => c.id === section)?.people.length).toBeGreaterThan(0);

    const add = { rank: "PTE", name: "NEW ROT MAN" };
    expect(refused(await addPersonToRoster(as, { ...add, campId: slrCamp, role: "ST CBT" }))).toMatch(/switched off in ROT/);
    expect(refused(await addPersonToRoster(as, { ...add, campId: section, role: "ST CBT" }))).toMatch(/Pick a role/);
    ok(await addPersonToRoster(as, { ...add, campId: section, role: "CBT" }));

    const s = await eveningRound(recordingCourier(), new Date(), { force: true });
    expect(s).toMatchObject({ short: 0, rf: 0 });
    // a man added to a section during ROT keeps Switch back from deleting it
    expect(refused(await switchBack(recordingCourier(), as))).toMatch(/NEW ROT MAN joined a section during ROT/);
    vi.unstubAllEnvs();
  });
});
