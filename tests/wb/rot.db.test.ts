// ROT through the database: the phase read. Uses sabre_test; skipped if unreachable.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { writeCoy } from "@/lib/data/write-coy";
import { renderParadeState } from "@/lib/parade";
import { db } from "@/lib/db";
import { coy } from "@/lib/db/schema";
import { wbChangeover, wbPhase } from "@/lib/wb/db/schema";
import { emptyLog } from "@/lib/wb/domain/rot";
import { phaseOf, phaseState } from "@/lib/wb/phase";
import { paradeView } from "@/lib/wb/rot-parade";
import { EXAMPLE_CAA, exampleSnapshot } from "../fixtures/example-snapshot";

let reachable = true;
let coyId = "";

async function cleanRot() {
  await db.delete(wbPhase);
  await db.delete(wbChangeover);
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
