import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { sgtToInstant } from "@/lib/parade/time";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { Refusal } from "@/lib/wb/core";
import { wbAudit as wbAuditTable, wbMember, wbShiftOverride, wbStayoutNight } from "@/lib/wb/db/schema";
import { manAccess } from "@/lib/wb/domain/access";
import { campOnAt, nightOver, onStayout, STAYOUT_FROM, type StayoutMan } from "@/lib/wb/domain/stayout";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { loadPatterns } from "@/lib/wb/forecast-data";
import { memberLabel, personWhere, type Db } from "@/lib/wb/records";
import { write, type Acting, type Outcome } from "@/lib/wb/write";

// Stay-out (status §3e, A): who's out on a night, the GC's taps on the
// evening "🏠 Stay-out tonight", and his commanders changing it from Person
// history. The projector reads the same facts (lib/wb/projection.ts) and puts
// him on the parade state from 2100; the rules are in domain/stayout.ts.

export interface StayoutRoll {
  subunitId: string;
  subunitName: string;
  night: string;
  men: (StayoutMan & { campId: string })[];
  /** whoever tapped ✅ Correct, once he has */
  confirmedBy: string | null;
}

/**
 * Per platoon, the men on stay-out on `night` whose camp is on shift at 2100
 * that night, with what was tapped for them. One platoon, or all of them.
 */
export async function stayoutRolls(night: string, subunitId: string | null = null, tx: Db = db): Promise<StayoutRoll[]> {
  const rows = await tx
    .select({
      personId: person.id,
      rank: person.rank,
      name: person.name,
      campId: camp.id,
      campName: camp.name,
      onShift: camp.onShift,
      subunitId: subunit.id,
      subunitName: subunit.name,
      stayout: wbMember.stayout,
      stayoutUntil: wbMember.stayoutUntil,
      state: wbStayoutNight.state,
      by: wbStayoutNight.by,
    })
    .from(wbMember)
    .innerJoin(person, and(eq(person.id, wbMember.personId), eq(person.active, true)))
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(wbStayoutNight, and(eq(wbStayoutNight.personId, person.id), eq(wbStayoutNight.night, night)))
    .where(
      and(
        eq(wbMember.active, true),
        sql`${wbMember.registeredAt} is not null`,
        inArray(wbMember.stayout, ["PERM", "TEMP"]),
        subunitId ? eq(subunit.id, subunitId) : undefined,
      ),
    )
    .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder));
  const out = rows.filter((r) => onStayout(r, night));
  if (!out.length) return [];

  const at = sgtToInstant({ date: night, time: STAYOUT_FROM });
  const [patterns, overrides] = await Promise.all([
    loadPatterns(tx),
    tx
      .select({ campId: wbShiftOverride.campId, on: wbShiftOverride.on, fromAt: wbShiftOverride.fromAt, untilAt: wbShiftOverride.untilAt })
      .from(wbShiftOverride)
      .where(and(isNull(wbShiftOverride.clearedAt), gt(wbShiftOverride.untilAt, at))),
  ]);
  const rolls = new Map<string, StayoutRoll & { confirmer: string | null }>();
  for (const r of out) {
    if (!campOnAt(patterns.get(r.campId), overrides.filter((o) => o.campId === r.campId), r.onShift, at)) continue;
    const roll = rolls.get(r.subunitId) ?? { subunitId: r.subunitId, subunitName: r.subunitName, night, men: [], confirmedBy: null, confirmer: null };
    roll.men.push({ personId: r.personId, rank: r.rank, name: r.name, campId: r.campId, campName: r.campName, state: r.state });
    if (r.state === "CONFIRMED" && r.by && !roll.confirmer) roll.confirmer = r.by;
    rolls.set(r.subunitId, roll);
  }
  return Promise.all(
    [...rolls.values()].map(async ({ confirmer, ...roll }) => ({ ...roll, confirmedBy: confirmer ? await memberLabel(confirmer, tx) : null })),
  );
}

/**
 * A tap on the evening message. ok: ✅ Correct, every man the tapper commands
 * who isn't staying in is CONFIRMED. in: one man staying in, or back out
 * (CONFIRMED again if the night was already confirmed, else untapped). Only
 * his GC, PC or PS (or OC/2IC/CSM) may, as for "Back?". The write's sync puts
 * a staying-in after 2100 right.
 */
export async function markStayout(by: Acting, tap: { id: string; night: string; act: "ok" | "in" }, now: Date = new Date()): Promise<Outcome<{ roll: StayoutRoll | null; said: string }>> {
  const res = await write(null, by, {
    parade: true,
    async change({ tx, audit }) {
      if (nightOver(tap.night, now)) throw new Refusal("That night is over.");
      if (tap.act === "ok") {
        const [roll] = await stayoutRolls(tap.night, tap.id, tx);
        const mine = (roll?.men ?? []).filter((m) => manAccess(by.actor, { subunitId: roll.subunitId, campId: m.campId }).confirmsBack);
        if (!mine.length) throw new Refusal("Only their GC, PC or PS can confirm.");
        const marks = mine.filter((m) => m.state === null);
        if (marks.length) {
          await tx
            .insert(wbStayoutNight)
            .values(marks.map((m) => ({ personId: m.personId, night: tap.night, state: "CONFIRMED" as const, by: by.actor.id, at: now })))
            .onConflictDoNothing();
          await audit({ action: "stayout-night", entity: "wb_stayout_night", entityId: tap.id, after: { night: tap.night, state: "CONFIRMED", people: marks.map((m) => m.personId) } });
        }
        return { subunitId: tap.id, said: "Confirmed" };
      }

      const p = await personWhere(tap.id, tx);
      if (!p) throw new Refusal("He's no longer on the roster.");
      const label = `${p.rank} ${p.name}`;
      if (!manAccess(by.actor, p).confirmsBack) throw new Refusal(`Only ${label}'s GC, PC or PS can say that.`);
      const where = and(eq(wbStayoutNight.personId, p.personId), eq(wbStayoutNight.night, tap.night));
      const [had] = await tx.select({ state: wbStayoutNight.state }).from(wbStayoutNight).where(where).for("update");
      let state: "CONFIRMED" | "STAYING_IN" | null;
      if (had?.state === "STAYING_IN") {
        // back out: confirmed like the rest if ✅ Correct was already tapped (its audit row says so), else untapped
        const [confirmed] = await tx
          .select({ id: wbAuditTable.id })
          .from(wbAuditTable)
          .where(and(eq(wbAuditTable.action, "stayout-night"), eq(wbAuditTable.entityId, p.subunitId), sql`${wbAuditTable.after}->>'night' = ${tap.night}`))
          .limit(1);
        state = confirmed ? "CONFIRMED" : null;
        if (state) await tx.update(wbStayoutNight).set({ state, by: by.actor.id, at: now }).where(where);
        else await tx.delete(wbStayoutNight).where(where);
      } else {
        state = "STAYING_IN";
        await tx
          .insert(wbStayoutNight)
          .values({ personId: p.personId, night: tap.night, state, by: by.actor.id, at: now })
          .onConflictDoUpdate({ target: [wbStayoutNight.personId, wbStayoutNight.night], set: { state, by: by.actor.id, at: now } });
      }
      await audit({ action: "stayout-night", entity: "person", entityId: p.personId, before: { state: had?.state ?? null }, after: { night: tap.night, state } });
      return { subunitId: p.subunitId, said: state === "STAYING_IN" ? `${label} staying in` : `${label} stays out` };
    },
  });
  if (!res.ok) return res;
  const [roll] = await stayoutRolls(tap.night, res.value.subunitId);
  return { ok: true, value: { roll: roll ?? null, said: res.value.said } };
}

// ------------------------------------------------------------------ Person history

export interface StayoutOf {
  registered: boolean;
  stayout: "NONE" | "PERM" | "TEMP";
  stayoutUntil: string | null;
}

/** His account's stay-out, for Person history. Null: nobody has registered as him. */
export async function stayoutOf(personId: string): Promise<StayoutOf | null> {
  const [m] = await db
    .select({ registeredAt: wbMember.registeredAt, stayout: wbMember.stayout, stayoutUntil: wbMember.stayoutUntil })
    .from(wbMember)
    .where(and(eq(wbMember.personId, personId), eq(wbMember.active, true)));
  return m ? { registered: !!m.registeredAt, stayout: m.stayout, stayoutUntil: m.stayoutUntil } : null;
}

/** Change whether he's stay-out: his PC or PS, or OC/2IC/CSM/ADMIN. Only on his account, so he must have registered. */
export async function setStayout(by: Acting, personId: string, to: { stayout: "NONE" | "PERM" | "TEMP"; until: string | null }, now: Date = new Date()): Promise<Outcome<{ label: string }>> {
  return write(null, by, {
    parade: true,
    async change({ tx, audit }) {
      const p = await personWhere(personId, tx);
      if (!p) throw new Refusal("He's no longer on the roster.");
      const label = `${p.rank} ${p.name}`;
      if (!manAccess(by.actor, p).stayout) throw new Refusal(`Only ${label}'s PC or PS, or the OC, 2IC or CSM, can change his stay-out.`);
      const [m] = await tx
        .select({ id: wbMember.id, registeredAt: wbMember.registeredAt, stayout: wbMember.stayout, stayoutUntil: wbMember.stayoutUntil })
        .from(wbMember)
        .where(and(eq(wbMember.personId, personId), eq(wbMember.active, true)))
        .for("update");
      if (!m?.registeredAt) throw new Refusal(`${label} hasn't registered, so Sabre can't keep his stay-out yet.`);
      const until = to.stayout === "TEMP" ? to.until : null;
      if (to.stayout === "TEMP" && (!until || until < todaySgt(now))) throw new Refusal("The last day of his stay-out can't be in the past.");
      await tx.update(wbMember).set({ stayout: to.stayout, stayoutUntil: until }).where(eq(wbMember.id, m.id));
      await audit({
        action: "set-stayout",
        entity: "wb_member",
        entityId: m.id,
        before: { stayout: m.stayout, stayoutUntil: m.stayoutUntil },
        after: { stayout: to.stayout, stayoutUntil: until, personId },
      });
      return { label };
    },
  });
}
