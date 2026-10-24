// ROT through the database: the phase read. Uses sabre_test; skipped if unreachable.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { coy } from "@/lib/db/schema";
import { wbChangeover, wbPhase } from "@/lib/wb/db/schema";
import { emptyLog } from "@/lib/wb/domain/rot";
import { phaseOf, phaseState } from "@/lib/wb/phase";
import { exampleSnapshot } from "../fixtures/example-snapshot";

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
