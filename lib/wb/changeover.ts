import "server-only";
import { and, eq, inArray, max, ne, sql } from "drizzle-orm";
import { getCoy } from "@/lib/data/snapshot";
import { camp, person, subunit } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import { wbDraftGrant, wbDraftPlacement, wbDraftPlatoon, wbDraftSection } from "@/lib/wb/db/schema";
import { cleanName, isSvc } from "@/lib/wb/domain/rot";
import { runsChangeover } from "@/lib/wb/changeover-data";
import { phaseOf } from "@/lib/wb/phase";
import type { Db } from "@/lib/wb/records";
import { write, type Acting, type Change } from "@/lib/wb/write";

// The changeover's draft (phases-plan §3): platoons and sections, who goes
// where, and their SCs, PCs and PSes. Nothing here touches the parade state:
// the draft only becomes v1 rows at Switch to ROT (lib/wb/switch.ts). Each
// write is refused once the company is in ROT, and for anyone outside COY HQ
// who isn't an admin.

const MAX_NAME = 40;

/** One draft write: the gate, the phase, then the change. */
function draftWrite<T>(by: Acting, change: (c: Change, coyId: string) => Promise<T>) {
  return write(null, by, {
    parade: false,
    async change(c) {
      const coy = await getCoy();
      if (!(await runsChangeover(by.actor, c.tx))) throw new Refusal("Only COY HQ and admins can work on the changeover.");
      if ((await phaseOf(coy.id, c.tx)) !== "VIGILANCE") throw new Refusal("The company is in ROT already. Switch back to change the draft.");
      return change(c, coy.id);
    },
  });
}

function nameOf(raw: string, what: string): string {
  const name = cleanName(raw);
  if (!name) throw new Refusal(`Type a name for the ${what}.`);
  if (name.length > MAX_NAME) throw new Refusal(`Keep the ${what}'s name under ${MAX_NAME} letters.`);
  return name;
}

async function platoonIn(tx: Db, coyId: string, platoonId: string) {
  const [p] = await tx.select().from(wbDraftPlatoon).where(and(eq(wbDraftPlatoon.id, platoonId), eq(wbDraftPlatoon.coyId, coyId)));
  if (!p) throw new Refusal("That platoon is no longer in the draft.");
  return p;
}

async function sectionIn(tx: Db, coyId: string, sectionId: string) {
  const [s] = await tx
    .select({ s: wbDraftSection, platoon: wbDraftPlatoon.name })
    .from(wbDraftSection)
    .innerJoin(wbDraftPlatoon, eq(wbDraftPlatoon.id, wbDraftSection.platoonId))
    .where(and(eq(wbDraftSection.id, sectionId), eq(wbDraftPlatoon.coyId, coyId)));
  if (!s) throw new Refusal("That section is no longer in the draft.");
  return { ...s.s, platoon: s.platoon };
}

// ------------------------------------------------------------------ structure

export async function addPlatoon(by: Acting, raw: string) {
  return draftWrite(by, async ({ tx, audit }, coyId) => {
    const name = nameOf(raw, "platoon");
    const [hq] = await tx.select({ id: subunit.id }).from(subunit).where(and(eq(subunit.coyId, coyId), eq(subunit.isHq, true), eq(subunit.name, name)));
    if (hq) throw new Refusal(`${name} stays as it is. Draft the platoons only.`);
    const [dup] = await tx.select({ id: wbDraftPlatoon.id }).from(wbDraftPlatoon).where(and(eq(wbDraftPlatoon.coyId, coyId), eq(wbDraftPlatoon.name, name)));
    if (dup) throw new Refusal(`${name} is in the draft already.`);
    const [{ last }] = await tx.select({ last: max(wbDraftPlatoon.sortOrder) }).from(wbDraftPlatoon).where(eq(wbDraftPlatoon.coyId, coyId));
    const [row] = await tx.insert(wbDraftPlatoon).values({ coyId, name, sortOrder: (last ?? -1) + 1 }).returning();
    await audit({ action: "draft-platoon", entity: "wb_draft_platoon", entityId: row.id, after: { name } });
    return { id: row.id, name };
  });
}

export async function removePlatoon(by: Acting, platoonId: string) {
  return draftWrite(by, async ({ tx, audit }, coyId) => {
    const p = await platoonIn(tx, coyId, platoonId);
    await tx.delete(wbDraftPlatoon).where(eq(wbDraftPlatoon.id, p.id));
    await audit({ action: "draft-platoon-remove", entity: "wb_draft_platoon", entityId: p.id, before: { name: p.name } });
    return { name: p.name };
  });
}

/** A new section at the end of its platoon: "SECTION n" unless named. */
export async function addSection(by: Acting, platoonId: string, raw?: string) {
  return draftWrite(by, async ({ tx, audit }, coyId) => {
    const p = await platoonIn(tx, coyId, platoonId);
    const existing = await tx.select({ name: wbDraftSection.name, sortOrder: wbDraftSection.sortOrder }).from(wbDraftSection).where(eq(wbDraftSection.platoonId, p.id));
    let name = raw?.trim() ? nameOf(raw, "section") : "";
    if (!name) for (let n = existing.length + 1; !name || existing.some((s) => s.name === name); n++) name = `SECTION ${n}`;
    if (existing.some((s) => s.name === name)) throw new Refusal(`${p.name} has a ${name} already.`);
    const sortOrder = Math.max(-1, ...existing.map((s) => s.sortOrder)) + 1;
    const [row] = await tx.insert(wbDraftSection).values({ platoonId: p.id, name, sortOrder }).returning();
    await audit({ action: "draft-section", entity: "wb_draft_section", entityId: row.id, after: { platoon: p.name, name } });
    return { id: row.id, name, platoon: p.name };
  });
}

/** The men placed there go back to "not in a section yet". */
export async function removeSection(by: Acting, sectionId: string) {
  return draftWrite(by, async ({ tx, audit }, coyId) => {
    const s = await sectionIn(tx, coyId, sectionId);
    const men = await tx.delete(wbDraftPlacement).where(eq(wbDraftPlacement.sectionId, s.id)).returning();
    await tx.delete(wbDraftSection).where(eq(wbDraftSection.id, s.id));
    await audit({ action: "draft-section-remove", entity: "wb_draft_section", entityId: s.id, before: { platoon: s.platoon, name: s.name, men: men.length } });
    return { name: `${s.platoon} ${s.name}`, unplaced: men.length };
  });
}

// ------------------------------------------------------------------ commanders

export type CommanderRole = "SC" | "PC" | "PS";

/**
 * Draft a commander, or take one off (`personId` null for SC/PC; a PS is
 * added or taken off one at a time, since a platoon may have more than one).
 * An SC must already be placed in his section, and is SC of that one only.
 * PCs and PSes come from COY HQ, where they sit (phases-plan §2).
 */
export async function setCommander(by: Acting, input: { role: CommanderRole; scopeId: string; personId: string | null; remove?: boolean }) {
  return draftWrite(by, async ({ tx, audit }, coyId) => {
    const scope = input.role === "SC" ? { sectionId: (await sectionIn(tx, coyId, input.scopeId)).id, platoonId: null } : { platoonId: (await platoonIn(tx, coyId, input.scopeId)).id, sectionId: null };
    const here = and(eq(wbDraftGrant.role, input.role), scope.sectionId ? eq(wbDraftGrant.sectionId, scope.sectionId) : eq(wbDraftGrant.platoonId, scope.platoonId!));
    if (input.role === "PS" && input.personId) {
      if (input.remove) {
        const gone = await tx.delete(wbDraftGrant).where(and(here, eq(wbDraftGrant.personId, input.personId))).returning();
        for (const g of gone) await audit({ action: "draft-grant-remove", entity: "wb_draft_grant", entityId: g.id, before: g });
        return { changed: gone.length > 0 };
      }
    } else {
      const gone = await tx.delete(wbDraftGrant).where(here).returning();
      for (const g of gone) await audit({ action: "draft-grant-remove", entity: "wb_draft_grant", entityId: g.id, before: g });
    }
    if (!input.personId) return { changed: true };

    const [p] = await tx
      .select({ active: person.active, isHq: subunit.isHq, coyId: camp.coyId })
      .from(person)
      .innerJoin(camp, eq(camp.id, person.campId))
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .where(eq(person.id, input.personId));
    if (!p?.active || p.coyId !== coyId) throw new Refusal("He's no longer on the roster.");
    if (input.role === "SC") {
      const [placed] = await tx.select().from(wbDraftPlacement).where(eq(wbDraftPlacement.personId, input.personId));
      if (placed?.sectionId !== scope.sectionId) throw new Refusal("Place him in this section first.");
      // an SC of one section only
      await tx.delete(wbDraftGrant).where(and(eq(wbDraftGrant.role, "SC"), eq(wbDraftGrant.personId, input.personId)));
    } else if (!p.isHq) {
      throw new Refusal("PCs and PSes are drafted from COY HQ.");
    }
    const [row] = await tx
      .insert(wbDraftGrant)
      .values({ role: input.role, personId: input.personId, ...scope })
      .onConflictDoNothing()
      .returning();
    if (row) await audit({ action: "draft-grant", entity: "wb_draft_grant", entityId: row.id, after: row });
    return { changed: true };
  });
}

// ------------------------------------------------------------------ placing men

/**
 * Why this man can't be placed, or null: on the roster, in this coy, outside
 * COY HQ, and a combat trooper (SVC troopers leave at the switch).
 */
async function placeable(tx: Db, coyId: string, personIds: readonly string[]) {
  const rows = personIds.length
    ? await tx
        .select({ id: person.id, rank: person.rank, name: person.name, role: person.role, active: person.active, isHq: subunit.isHq, coyId: camp.coyId })
        .from(person)
        .innerJoin(camp, eq(camp.id, person.campId))
        .innerJoin(subunit, eq(subunit.id, camp.subunitId))
        .where(inArray(person.id, [...personIds]))
    : [];
  const refusals: string[] = [];
  for (const id of personIds) {
    const r = rows.find((x) => x.id === id);
    if (!r?.active || r.coyId !== coyId) refusals.push("Someone you picked is no longer on the roster.");
    else if (r.isHq) refusals.push(`${r.rank} ${r.name} is in COY HQ, which stays as it is.`);
    else if (isSvc(r.role)) refusals.push(`${r.rank} ${r.name} is an SVC trooper: they leave at the switch.`);
  }
  if (refusals.length) throw new Refusal([...new Set(refusals)].join(" "));
}

/** Put men in a section (moving them if they were in another). An SC moved out stops being its SC. */
async function placeIn(c: Change, by: Acting, personIds: readonly string[], sectionId: string) {
  const { tx, audit } = c;
  const before = personIds.length ? await tx.select().from(wbDraftPlacement).where(inArray(wbDraftPlacement.personId, [...personIds])) : [];
  const moved = before.filter((b) => b.sectionId !== sectionId).map((b) => b.personId);
  if (moved.length) await tx.delete(wbDraftGrant).where(and(eq(wbDraftGrant.role, "SC"), inArray(wbDraftGrant.personId, moved), ne(wbDraftGrant.sectionId, sectionId)));
  let n = 0;
  for (const personId of personIds) {
    if (before.some((b) => b.personId === personId && b.sectionId === sectionId)) continue;
    await tx
      .insert(wbDraftPlacement)
      .values({ personId, sectionId, placedBy: by.actor.id })
      .onConflictDoUpdate({ target: wbDraftPlacement.personId, set: { sectionId, placedBy: by.actor.id, placedAt: sql`now()` } });
    n++;
  }
  if (n) await audit({ action: "draft-place", entity: "wb_draft_section", entityId: sectionId, after: { personIds, moved } });
  return n;
}

export async function placeMen(by: Acting, personIds: readonly string[], sectionId: string) {
  return draftWrite(by, async (c, coyId) => {
    const s = await sectionIn(c.tx, coyId, sectionId);
    await placeable(c.tx, coyId, personIds);
    return { placed: await placeIn(c, by, personIds, s.id), section: `${s.platoon} ${s.name}` };
  });
}

/** "Move all of camp X here": every combat trooper of that camp not in a section yet. */
export async function placeCamp(by: Acting, campId: string, sectionId: string) {
  return draftWrite(by, async (c, coyId) => {
    const s = await sectionIn(c.tx, coyId, sectionId);
    const men = await c.tx
      .select({ id: person.id, role: person.role, placed: wbDraftPlacement.sectionId })
      .from(person)
      .innerJoin(camp, eq(camp.id, person.campId))
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .leftJoin(wbDraftPlacement, eq(wbDraftPlacement.personId, person.id))
      .where(and(eq(person.campId, campId), eq(person.active, true), eq(camp.coyId, coyId), eq(subunit.isHq, false)));
    const ids = men.filter((m) => !m.placed && !isSvc(m.role)).map((m) => m.id);
    return { placed: await placeIn(c, by, ids, s.id), section: `${s.platoon} ${s.name}` };
  });
}

export async function unplaceMen(by: Acting, personIds: readonly string[]) {
  return draftWrite(by, async ({ tx, audit }) => {
    if (!personIds.length) return { unplaced: 0 };
    const gone = await tx.delete(wbDraftPlacement).where(inArray(wbDraftPlacement.personId, [...personIds])).returning();
    await tx.delete(wbDraftGrant).where(and(eq(wbDraftGrant.role, "SC"), inArray(wbDraftGrant.personId, [...personIds])));
    for (const g of gone) await audit({ action: "draft-unplace", entity: "wb_draft_placement", entityId: g.personId, before: { sectionId: g.sectionId } });
    return { unplaced: gone.length };
  });
}

// ------------------------------------------------------------------ the pasted list

export interface PastedPlacement {
  personId: string;
  platoon: string;
  section: string;
  sc: boolean;
}

/**
 * Assign what the check screen confirmed: platoons and sections the list
 * names are drafted if they aren't yet, each man goes to his section, and a
 * man marked (SC) becomes its SC. Only the men named change (a later paste
 * of another part leaves the rest alone).
 */
export async function assignPasted(by: Acting, rows: readonly PastedPlacement[]) {
  return draftWrite(by, async (c, coyId) => {
    const { tx, audit } = c;
    await placeable(tx, coyId, rows.map((r) => r.personId));
    if (new Set(rows.map((r) => r.personId)).size !== rows.length) throw new Refusal("Someone is in the list twice. Read the list again.");
    const platoons = await tx.select().from(wbDraftPlatoon).where(eq(wbDraftPlatoon.coyId, coyId));
    const created: string[] = [];
    const sectionId = new Map<string, string>();
    for (const r of rows) {
      const platoonName = nameOf(r.platoon, "platoon");
      const sectionName = nameOf(r.section, "section");
      const key = `${platoonName}\u0000${sectionName}`;
      if (sectionId.has(key)) continue;
      let pl = platoons.find((p) => p.name === platoonName);
      if (!pl) {
        const sortOrder = Math.max(-1, ...platoons.map((p) => p.sortOrder)) + 1;
        [pl] = await tx.insert(wbDraftPlatoon).values({ coyId, name: platoonName, sortOrder }).returning();
        platoons.push(pl);
        created.push(platoonName);
        await audit({ action: "draft-platoon", entity: "wb_draft_platoon", entityId: pl.id, after: { name: platoonName, from: "paste" } });
      }
      const secs = await tx.select().from(wbDraftSection).where(eq(wbDraftSection.platoonId, pl.id));
      let sec = secs.find((s) => s.name === sectionName);
      if (!sec) {
        [sec] = await tx
          .insert(wbDraftSection)
          .values({ platoonId: pl.id, name: sectionName, sortOrder: Math.max(-1, ...secs.map((s) => s.sortOrder)) + 1 })
          .returning();
        created.push(`${platoonName} ${sectionName}`);
        await audit({ action: "draft-section", entity: "wb_draft_section", entityId: sec.id, after: { platoon: platoonName, name: sectionName, from: "paste" } });
      }
      sectionId.set(key, sec.id);
    }
    let placed = 0;
    for (const [key, id] of sectionId) {
      const [platoonName, sectionName] = key.split("\u0000");
      const here = rows.filter((r) => cleanName(r.platoon) === platoonName && cleanName(r.section) === sectionName);
      placed += await placeIn(c, by, here.map((r) => r.personId), id);
      const sc = here.find((r) => r.sc);
      if (sc) {
        await tx.delete(wbDraftGrant).where(and(eq(wbDraftGrant.role, "SC"), sql`(${wbDraftGrant.sectionId} = ${id} or ${wbDraftGrant.personId} = ${sc.personId})`));
        const [g] = await tx.insert(wbDraftGrant).values({ role: "SC", personId: sc.personId, sectionId: id }).returning();
        await audit({ action: "draft-grant", entity: "wb_draft_grant", entityId: g.id, after: { ...g, from: "paste" } });
      }
    }
    return { placed, named: rows.length, created };
  });
}
