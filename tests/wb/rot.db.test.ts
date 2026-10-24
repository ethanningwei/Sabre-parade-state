// ROT through the database: the phase read, the parade state by phase, and
// the changeover's draft (who may, platoons and sections, placing men, SCs,
// PCs and PSes, the pasted list). Uses sabre_test; skipped if unreachable.

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { writeCoy } from "@/lib/data/write-coy";
import { renderParadeState } from "@/lib/parade";
import { db } from "@/lib/db";
import { camp, coy, person } from "@/lib/db/schema";
import { wbAudit, wbChangeover, wbDraftPlatoon, wbGrant, wbMember, wbPhase } from "@/lib/wb/db/schema";
import { emptyLog } from "@/lib/wb/domain/rot";
import { phaseOf, phaseState } from "@/lib/wb/phase";
import { paradeView } from "@/lib/wb/rot-parade";
import { EXAMPLE_CAA, exampleSnapshot } from "../fixtures/example-snapshot";
import { acting, member, ok } from "./writes";

const { addPlatoon, addSection, assignPasted, placeCamp, placeMen, removeSection, setCommander, unplaceMen } = await import("@/lib/wb/changeover");
const { checkPaste, checklist, loadDraft, preview } = await import("@/lib/wb/changeover-data");

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
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
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
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  coyId = (await db.select({ id: coy.id }).from(coy).where(eq(coy.key, "SABRE")))[0].id;
});
afterAll(async () => {
  if (reachable) await cleanRot();
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
