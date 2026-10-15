import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wbAudit } from "@/lib/wb/audit";
import { inTx, Refusal, type Via } from "@/lib/wb/core";
import { wbClaim } from "@/lib/wb/db/schema";
import {
  claimDates,
  claimKey,
  MAX_PLACE,
  officeAddress,
  placeText,
  requestStamp,
  sheetRow,
  slashDate,
  verdictText,
  type Place,
  type Vehicle,
} from "@/lib/wb/domain/claims";
import { addDays, todaySgt } from "@/lib/wb/domain/timeline";
import { personWhere } from "@/lib/wb/records";
import type { ClaimSheet } from "@/lib/wb/sheets";
import type { Courier } from "@/lib/wb/telegram/courier";

// Transport claims (Phase 7): the Mini App replaces the Form SG, and the OC
// keeps deciding on his Google Sheet (the user, 2026-10-15). Submit writes one
// wb_claim per day and appends them to the sheet; the evening round retries
// any the sheet didn't take, reads the OC's verdicts back and DMs each man.

/** Keep reading a row back this long after its trip; after that the OC has stopped looking. */
const WATCH_DAYS = 30;

export type SheetDelivery = "sent" | "not-set" | "failed";

export interface ClaimInput {
  vehicle: Vehicle;
  first: string;
  also: readonly string[];
  start: Place;
  end: Place;
  reason: string;
  roundTrip: boolean;
}

export interface Claimant {
  id: string;
  personId: string | null;
  fullName: string | null;
}

/** His own claim, one row per day, then onto the OC's sheet. Only for himself (the user, 2026-10-15). */
export async function submitClaim(sheet: ClaimSheet | null, me: Claimant, input: ClaimInput, via: Via, now: Date = new Date()) {
  const res = await inTx(async (tx) => {
    if (!me.personId) throw new Refusal("You're not on the roster yet. Ask your PS to add you.");
    const p = await personWhere(me.personId, tx);
    if (!p) throw new Refusal("You're not on the roster yet. Ask your PS to add you.");
    const dates = claimDates(input.first, input.also, todaySgt(now));
    if (!dates) throw new Refusal("A claim is approved before the trip: pick today or a later day, and more days only in the fortnight after it.");
    const office = officeAddress(p.campName);
    const start = placeText(input.start, office);
    const end = placeText(input.end, office);
    if (!start || !end) throw new Refusal("Say where the trip starts and ends.");
    if (start.length > MAX_PLACE || end.length > MAX_PLACE) throw new Refusal("Keep each place short, e.g. SINGAPORE GENERAL HOSPITAL.");
    if (start === end && !input.roundTrip) throw new Refusal("The trip starts and ends in the same place. Is it a round trip?");

    const batchId = randomUUID();
    const common = {
      batchId,
      personId: p.personId,
      memberId: me.id,
      vehicle: input.vehicle,
      startPlace: start,
      endPlace: end,
      reason: input.reason.trim().toUpperCase().replace(/\s+/g, " "),
      roundTrip: input.roundTrip,
      rank: p.rank,
      // the sheet holds full names: it's a claim against a real person
      sheetName: (me.fullName || p.name).toUpperCase(),
      platoon: p.subunitName,
      requested: requestStamp(now),
      createdAt: now,
    };
    const rows = await tx
      .insert(wbClaim)
      .values(dates.map((tripDate) => ({ ...common, tripDate })))
      .returning();
    await wbAudit(tx, { memberId: me.id, via, action: "claim-submit", entity: "wb_claim", entityId: batchId, after: { dates, start, end, vehicle: input.vehicle } });
    return rows;
  });
  if (!res.ok) return res;
  const sent = await exportClaims(sheet, res.value.map((r) => r.id));
  return { ok: true as const, value: { batchId: res.value[0].batchId, rows: res.value, sheet: sent } };
}

/**
 * Append claims to the sheet: these ids, or every one still waiting for it
 * whose trip hasn't passed. One writer at a time, because the next free row is
 * worked out by counting.
 */
export async function exportClaims(sheet: ClaimSheet | null, ids?: readonly string[], now: Date = new Date()): Promise<SheetDelivery> {
  if (!sheet) return "not-set";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wb-claims-sheet'))`);
    const waiting = await tx
      .select()
      .from(wbClaim)
      .where(
        and(
          isNull(wbClaim.exportedAt),
          eq(wbClaim.state, "PENDING"),
          ids ? inArray(wbClaim.id, [...ids]) : gte(wbClaim.tripDate, todaySgt(now)),
        ),
      )
      .orderBy(asc(wbClaim.createdAt), asc(wbClaim.tripDate));
    if (!waiting.length) return "sent";
    try {
      const at = await sheet.add(waiting.map((c) => sheetRow({ ...c, name: c.sheetName })));
      for (const [i, c] of waiting.entries()) {
        await tx.update(wbClaim).set({ exportedAt: new Date(), sheetTab: sheet.tab, sheetRow: at[i], exportError: null }).where(eq(wbClaim.id, c.id));
      }
      return "sent";
    } catch (e) {
      console.error("wb claims export:", e);
      await tx
        .update(wbClaim)
        .set({ exportError: String((e as Error)?.message ?? e).slice(0, 500) })
        .where(inArray(wbClaim.id, waiting.map((c) => c.id)));
      return "failed";
    }
  });
}

/**
 * Read the OC's verdicts back. Every exported claim still pending, whose trip
 * was in the last month, is looked for in every tab by whose, which day and
 * when asked. Found with APPROVED/REJECTED: decided. Found blank: still
 * pending. Not found at all: deleted on the sheet (REMOVED), and gone from the
 * Mini App too: the sheet is the record. Returns how many changed.
 */
export async function readVerdicts(sheet: ClaimSheet | null, now: Date = new Date()): Promise<number> {
  if (!sheet) return 0;
  const open = await db
    .select()
    .from(wbClaim)
    .where(and(eq(wbClaim.state, "PENDING"), isNotNull(wbClaim.exportedAt), gte(wbClaim.tripDate, addDays(todaySgt(now), -WATCH_DAYS))))
    .orderBy(asc(wbClaim.createdAt), asc(wbClaim.tripDate));
  if (!open.length) return 0;
  const found = await sheet.verdicts();
  if (!found.size) return 0; // an empty read is a broken read, not every row deleted
  let changed = 0;
  for (const c of open) {
    const queue = found.get(claimKey(c.sheetName, slashDate(c.tripDate), c.requested));
    let next: { state: "APPROVED" | "REJECTED" | "REMOVED"; remarks: string } | null = null;
    if (!queue?.length) {
      next = { state: "REMOVED", remarks: "" };
    } else {
      const v = queue.shift();
      if (v) next = v;
    }
    if (!next) continue;
    await db
      .update(wbClaim)
      .set({ state: next.state, remarks: next.remarks, decidedAt: now })
      .where(and(eq(wbClaim.id, c.id), eq(wbClaim.state, "PENDING")));
    changed++;
  }
  return changed;
}

/** DM each man what the OC decided, one message per request. A deleted row is just gone: no message. Returns how many messages went. */
export async function tellVerdicts(courier: Courier, now: Date = new Date()): Promise<number> {
  const decided = await db
    .select()
    .from(wbClaim)
    .where(and(ne(wbClaim.state, "PENDING"), isNull(wbClaim.toldAt)))
    .orderBy(asc(wbClaim.tripDate));
  const batches = new Map<string, typeof decided>();
  for (const c of decided) batches.set(c.batchId, [...(batches.get(c.batchId) ?? []), c]);
  let sent = 0;
  for (const rows of batches.values()) {
    const decided = rows.filter((r) => r.state !== "REMOVED");
    if (decided.length) sent += await courier.send({ person: rows[0].personId }, verdictText(decided), [[{ text: "My claims", route: "claims" }]]);
    // told even if the DM failed: the Mini App shows it, and a retry every evening would nag
    await db.update(wbClaim).set({ toldAt: now }).where(inArray(wbClaim.id, rows.map((r) => r.id)));
  }
  return sent;
}

/** Claims on the sheet the OC hasn't decided for more than `hours`. */
export async function claimsWaiting(now: Date = new Date(), hours = 12): Promise<{ n: number; oldest: Date | null }> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${wbClaim.createdAt})` })
    .from(wbClaim)
    .where(and(eq(wbClaim.state, "PENDING"), isNotNull(wbClaim.exportedAt), lt(wbClaim.createdAt, new Date(now.getTime() - hours * 3600_000)), gte(wbClaim.tripDate, todaySgt(now))));
  return { n: row?.n ?? 0, oldest: row?.oldest ? new Date(row.oldest) : null };
}

export type ClaimView = typeof wbClaim.$inferSelect;

/** His claims: undecided first, then the last month's, newest trip first. Deleted on the sheet: not shown. */
export async function myClaims(personId: string, now: Date = new Date()): Promise<ClaimView[]> {
  const rows = await db
    .select()
    .from(wbClaim)
    .where(and(eq(wbClaim.personId, personId), ne(wbClaim.state, "REMOVED"), gte(wbClaim.tripDate, addDays(todaySgt(now), -WATCH_DAYS))))
    .orderBy(asc(wbClaim.tripDate));
  return [...rows.filter((r) => r.state === "PENDING"), ...rows.filter((r) => r.state !== "PENDING").reverse()];
}
