// Loads a whole coy (structure, people, and optionally current absences and
// duties) into the DB. Used by the Sheets import and the dev seed — NOT by the
// app itself.
//
// People are updated in place, never wiped: each Sheet row is matched to the
// person already in the app (lib/data/roster-plan.ts) and edited, moved or
// added (or, if they were inactive in the same camp, brought back), and
// anyone the Sheet no longer has is marked inactive. So whatever
// hangs off a person (whereabouts records, Telegram links, history) survives a
// re-import. Subunits and camps are upserted by name. The import refuses to
// run when a name is ambiguous or the Sheet dropped a camp or subunit.
//
// mode "roster" (the import's default once the app is in use) touches only
// people and structure: absences, duties, which camps are on shift and the
// coy's Telegram chat stay as the app has them.
// mode "full" also replaces absences, duties, on-shift and the Telegram chat
// from the input (the dev seed, tests, and the pre-cutover parity proof).

import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { absence, camp, coy, duty, person, subunit } from "@/lib/db/schema";
import { loadRoster } from "@/lib/data/roster-db";
import { planRoster, rosterBlockers, sheetRows, sheetStructure, type RosterRow, type SheetRow } from "@/lib/data/roster-plan";
import type { CoySnapshot } from "@/lib/parade";

export interface CoyInput extends CoySnapshot {
  telegram?: { chatId: string | null; threadId: string | null };
}

export type WriteMode = "roster" | "full";

export class RosterBlockedError extends Error {
  constructor(public blockers: string[]) {
    super(`The import can't run:\n${blockers.map((b) => `- ${b}`).join("\n")}`);
  }
}

export async function writeCoy(db: Db, input: CoyInput, mode: WriteMode = "full") {
  return db.transaction(async (tx) => {
    const current = await loadRoster(tx, input.coy.key);
    const rows = sheetRows(input);
    const plan = planRoster(current.people, rows, {
      structure: { current: current.structure, sheet: sheetStructure(input) },
      inactive: current.inactive,
    });
    const blockers = rosterBlockers(plan);
    if (blockers.length) throw new RosterBlockedError(blockers);

    const telegram = input.telegram ? { telegramChatId: input.telegram.chatId, telegramThreadId: input.telegram.threadId } : {};
    const [c] = await tx
      .insert(coy)
      .values({ key: input.coy.key, displayName: input.coy.displayName, ...telegram })
      .onConflictDoUpdate({
        target: coy.key,
        set: { displayName: input.coy.displayName, ...(mode === "full" ? telegram : {}) },
      })
      .returning();

    // sheet row -> the person it matched, if any
    const matchOf = new Map<SheetRow, RosterRow>();
    for (const m of [...plan.kept, ...plan.moved, ...plan.revived]) matchOf.set(m.sheet, m.current);

    // off the roster first, so a name they free up can be taken in the same run
    if (plan.removed.length) {
      await tx.update(person).set({ active: false }).where(inArray(person.id, plan.removed.map((r) => r.id)));
    }

    const campIdByName = new Map<string, string>();
    const personIdMap = new Map<string, string>(); // input person id -> DB id
    const counts = {
      kept: plan.kept.length,
      moved: plan.moved.length,
      revived: plan.revived.length,
      added: 0,
      removed: plan.removed.length,
    };
    let campOrder = 0;
    let rowIndex = 0;

    for (const [si, s] of input.subunits.entries()) {
      const [srow] = await tx
        .insert(subunit)
        .values({ coyId: c.id, name: s.name, isHq: s.isHq, sortOrder: si })
        .onConflictDoUpdate({
          target: [subunit.coyId, subunit.name],
          set: { isHq: s.isHq, sortOrder: si },
        })
        .returning();

      for (const sc of s.camps) {
        const post = sc.post && sc.post !== sc.name ? sc.post : null;
        const [crow] = await tx
          .insert(camp)
          .values({ coyId: c.id, subunitId: srow.id, name: sc.name, post, onShift: sc.onShift, sortOrder: campOrder++ })
          .onConflictDoUpdate({
            target: [camp.coyId, camp.name],
            set: { subunitId: srow.id, post, sortOrder: campOrder - 1, ...(mode === "full" ? { onShift: sc.onShift } : {}) },
          })
          .returning();
        campIdByName.set(sc.name, crow.id);
        // snapshot camp ids may be fixture ids; map them too
        campIdByName.set(sc.id, crow.id);

        for (const [pi, p] of sc.people.entries()) {
          const match = matchOf.get(rows[rowIndex++]);
          const values = { campId: crow.id, name: p.name, rank: p.rank, role: p.role, sortOrder: pi, active: true };
          if (match) {
            await tx.update(person).set(values).where(eq(person.id, match.id));
            personIdMap.set(p.id, match.id);
          } else {
            const [prow] = await tx.insert(person).values(values).returning({ id: person.id });
            personIdMap.set(p.id, prow.id);
            counts.added++;
          }
        }
      }
    }

    if (mode === "roster") return { coyId: c.id, mode, ...counts };

    // full: absences and duties exactly as the input has them
    const activeIds = [...personIdMap.values()];
    if (activeIds.length) await tx.delete(absence).where(inArray(absence.personId, activeIds));
    let absences = 0;
    for (const p of input.subunits.flatMap((s) => s.camps.flatMap((sc) => sc.people))) {
      if (!p.absence) continue;
      const a = p.absence;
      await tx.insert(absence).values({
        personId: personIdMap.get(p.id)!,
        type: a.type,
        otherReason: a.otherReason,
        startDate: a.startDate,
        startTime: a.startTime,
        endDate: a.endDate,
        endTime: a.endTime,
        maTiming: a.maTiming,
        maLocation: a.maLocation,
      });
      absences++;
    }

    await tx.delete(duty).where(eq(duty.coyId, c.id));
    for (const [di, d] of input.duties.entries()) {
      const campId = campIdByName.get(d.campId);
      if (!campId) throw new Error(`Duty '${d.rank} ${d.name}' points at unknown camp '${d.campId}'`);
      await tx.insert(duty).values({
        coyId: c.id,
        type: d.type,
        rank: d.rank,
        name: d.name,
        personId: d.personId ? (personIdMap.get(d.personId) ?? null) : null,
        campId,
        startDate: d.startDate,
        startTime: d.startTime,
        endDate: d.endDate,
        endTime: d.endTime,
        sortOrder: di,
      });
    }

    return { coyId: c.id, mode, ...counts, absences, duties: input.duties.length };
  });
}

