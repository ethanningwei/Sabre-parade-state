import "server-only";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { toSgt } from "@/lib/parade/time";
import { wbAudit } from "@/lib/wb/audit";
import { inTx, Refusal, type Actor, type Via } from "@/lib/wb/core";
import { wbMinManning, wbShiftEvent, wbShiftOverride, wbShiftPattern } from "@/lib/wb/db/schema";
import { hasGrant } from "@/lib/wb/domain/grants";
import { canEditShifts, canHoto } from "@/lib/wb/domain/rules";
import {
  hotoEffect,
  minimumLabel,
  overrideWindow,
  pairProblem,
  parseMinimum,
  partnerPattern,
  stintAround,
  type Minimum,
  type ShiftPattern,
  type WbShiftKind,
} from "@/lib/wb/domain/shifts";
import { dayMonth } from "@/lib/wb/domain/timeline";
import { campsInfo, loadPatterns } from "@/lib/wb/forecast-data";
import { memberLabel } from "@/lib/wb/records";
import type { Courier } from "@/lib/wb/telegram/courier";

// Shifts: saving a camp's pattern and minimum, and logging a HOTO. Nothing
// here writes v1: a HOTO is logged in wb_shift_event and moves the pattern,
// and v1 camp.on_shift is left to the web app until Phase 6 (projection).

// ------------------------------------------------------------------ saving a pattern

export interface ShiftInput {
  /** the teams of one physical camp, as the screen showed them */
  campIds: string[];
  kind: WbShiftKind;
  onDays: number;
  offDays: number;
  /** CYCLE: which team starts its stint on anchorDate */
  anchorCampId: string | null;
  anchorDate: string | null;
  hotoTime: string;
  weekdayMask: number;
  holidaysOff: boolean;
  bothOnAllowed: boolean;
  /** campId -> "1:4:3", "8" or "" (no minimum) */
  minimums: Record<string, string>;
}

/** The patterns this input sets, one per team. A pair's other team follows the anchored one. */
export function patternsFrom(input: ShiftInput): ShiftPattern[] {
  const common = {
    kind: input.kind,
    onDays: input.onDays,
    offDays: input.offDays,
    hotoTime: input.hotoTime,
    weekdayMask: input.weekdayMask,
    holidaysOff: input.holidaysOff,
    bothOnAllowed: input.bothOnAllowed && input.campIds.length > 1,
  };
  if (input.kind !== "CYCLE") return input.campIds.map((campId) => ({ ...common, campId, anchorDate: null }));
  const lead = input.anchorCampId ?? input.campIds[0];
  const first: ShiftPattern = { ...common, campId: lead, anchorDate: input.anchorDate };
  return [first, ...input.campIds.filter((c) => c !== lead).map((c) => partnerPattern(first, c))];
}

export async function saveShift(actor: Actor, input: ShiftInput, via: Via = "MINIAPP") {
  return inTx(async (tx) => {
    const all = await campsInfo(tx);
    const teams = input.campIds.map((id) => all.find((c) => c.id === id));
    if (!teams.length || teams.some((t) => !t)) throw new Refusal("That camp no longer exists.");
    const post = teams[0]!;
    if (teams.some((t) => t!.post !== post.post || t!.subunitId !== post.subunitId)) throw new Refusal("Those teams aren't one camp.");
    // every team of the post, so a pair is never half-set
    const siblings = all.filter((c) => c.post === post.post && c.subunitId === post.subunitId);
    if (siblings.length !== teams.length) throw new Refusal("Set both teams of a camp together.");
    if (!canEditShifts(actor.grants, post.subunitId)) throw new Refusal(`Only ${post.subunitName}'s PC or PS can change its shifts.`);
    if (input.kind === "CYCLE") {
      if (!input.anchorDate) throw new Refusal("Say the day a team took over.");
      if (input.campIds.length > 2) throw new Refusal("A cycle works for one team or a pair.");
      if (input.campIds.length === 2 && input.onDays !== input.offDays) throw new Refusal("A pair's days on and off must match: one team is on while the other is off.");
    }
    if (input.kind === "WEEKLY" && !input.weekdayMask) throw new Refusal("Pick at least one day.");

    const patterns = patternsFrom(input);
    if (patterns.length === 2) {
      const names = patterns.map((p) => teams.find((t) => t!.id === p.campId)!.name) as [string, string];
      const problem = pairProblem(patterns[0], patterns[1], names);
      if (problem) throw new Refusal(problem);
    }
    const minimums = new Map<string, Minimum | null>();
    for (const t of teams) {
      const raw = (input.minimums[t!.id] ?? "").trim();
      const m = parseMinimum(raw);
      if (raw && !m) throw new Refusal(`${t!.name}'s minimum should look like 1:4:3 (GC:ST CBT:ST SVC), or a number.`);
      minimums.set(t!.id, m);
    }

    const before = { patterns: await tx.select().from(wbShiftPattern).where(inArray(wbShiftPattern.campId, input.campIds)), minimums: await tx.select().from(wbMinManning).where(inArray(wbMinManning.campId, input.campIds)) };
    const now = new Date();
    for (const p of patterns) {
      const values = { ...p, updatedBy: actor.id, updatedAt: now };
      await tx.insert(wbShiftPattern).values(values).onConflictDoUpdate({ target: wbShiftPattern.campId, set: values });
    }
    for (const [campId, m] of minimums) {
      if (!m) {
        await tx.delete(wbMinManning).where(eq(wbMinManning.campId, campId));
        continue;
      }
      const values = { campId, total: m.total, gc: m.roles?.GC ?? null, stCbt: m.roles?.["ST CBT"] ?? null, stSvc: m.roles?.["ST SVC"] ?? null, updatedBy: actor.id, updatedAt: now };
      await tx.insert(wbMinManning).values(values).onConflictDoUpdate({ target: wbMinManning.campId, set: values });
    }
    await wbAudit(tx, {
      memberId: actor.id,
      via,
      action: "shift-pattern",
      entity: "camp",
      entityId: post.id,
      before,
      after: { patterns, minimums: Object.fromEntries([...minimums].map(([k, v]) => [k, v ? minimumLabel(v) : null])) },
    });
    return { post: post.post };
  });
}

// ------------------------------------------------------------------ HOTO

export interface HotoResult {
  matched: boolean;
  /** what the pattern expected, if it had an opinion */
  expected: Date | null;
  /** the line posted to the commanders chat when it didn't match */
  alert: string | null;
}

const stamp = (d: Date) => `${dayMonth(toSgt(d).date)} ${toSgt(d).time}`;

/**
 * Log a HOTO: `campId` took over (on) or handed over at `at`. Matching the
 * pattern confirms it; otherwise the cycle moves (this team and its pair) and
 * the platoon's commanders chat is told. v1 camp.on_shift is not touched.
 */
export async function logHoto(courier: Courier, actor: Actor, input: { campId: string; on: boolean; at: Date; note?: string }, via: Via = "MINIAPP") {
  const res = await inTx(async (tx) => {
    const all = await campsInfo(tx);
    const team = all.find((c) => c.id === input.campId);
    if (!team) throw new Refusal("That camp no longer exists.");
    const teams = all.filter((c) => c.post === team.post && c.subunitId === team.subunitId);
    if (!canHoto(actor.grants, team.subunitId, teams.map((t) => t.id))) throw new Refusal(`Only ${team.post}'s GC or ${team.subunitName}'s PC or PS can log its HOTO.`);
    if (input.at.getTime() > Date.now() + 15 * 60_000) throw new Refusal("That's in the future. Log it when it happens.");
    if (input.at.getTime() < Date.now() - 2 * 86_400_000) throw new Refusal("That's more than two days ago. Ask your PS to fix the pattern instead.");
    const patterns = await loadPatterns(tx);
    const pattern = patterns.get(team.id);
    if (!pattern || pattern.kind !== "CYCLE") {
      throw new Refusal(pattern ? `${team.post} doesn't take turns, so there's no HOTO to log.` : `${team.post} has no shift pattern yet. Ask your PC or PS to set it in Shifts.`);
    }
    const effect = hotoEffect(pattern, { on: input.on, at: input.at });
    let alert: string | null = null;
    if (!effect.matched) {
      const moved: ShiftPattern = { ...pattern, anchorDate: effect.anchorDate };
      await tx.update(wbShiftPattern).set({ anchorDate: moved.anchorDate, updatedBy: actor.id, updatedAt: new Date() }).where(eq(wbShiftPattern.campId, team.id));
      const partner = teams.find((t) => t.id !== team.id);
      const partnerP = partner ? patterns.get(partner.id) : undefined;
      if (partner && partnerP?.kind === "CYCLE" && partnerP.onDays === pattern.onDays && partnerP.offDays === pattern.offDays) {
        await tx
          .update(wbShiftPattern)
          .set({ anchorDate: partnerPattern(moved, partner.id).anchorDate, updatedBy: actor.id, updatedAt: new Date() })
          .where(eq(wbShiftPattern.campId, partner.id));
      }
      const who = await memberLabel(actor.id, tx);
      const next = stintAround(moved, new Date(input.at.getTime() + 60_000));
      alert =
        `🔄 HOTO off the pattern · ${team.post}\n\n` +
        `${team.name} ${input.on ? "took over" : "handed over"} at ${stamp(input.at)} (logged by ${who}).\n` +
        (effect.expected ? `The pattern expected it at ${stamp(effect.expected)}.\n` : "There was no cycle set yet.\n") +
        (next ? `\nThe cycle has moved: ${team.name} is ${input.on ? "on" : "next on"} ${stamp(next.startAt)}–${stamp(next.endAt!)}.` : "");
    }
    await tx.insert(wbShiftEvent).values({ campId: team.id, at: input.at, on: input.on, by: actor.id, matched: effect.matched, note: input.note ?? "" });
    await wbAudit(tx, {
      memberId: actor.id,
      via,
      action: effect.matched ? "hoto" : "hoto-reanchor",
      entity: "camp",
      entityId: team.id,
      before: { anchorDate: pattern.anchorDate },
      after: { on: input.on, at: input.at.toISOString(), anchorDate: effect.matched ? pattern.anchorDate : effect.anchorDate },
    });
    return { team, matched: effect.matched, expected: effect.expected, alert };
  });
  if (!res.ok) return res;
  const { team, matched, expected, alert } = res.value;
  if (alert) await courier.send({ platoon: team.subunitId }, alert);
  return { ok: true as const, value: { matched, expected, alert } satisfies HotoResult };
}

/** The last few HOTOs of a physical camp's teams, newest first. */
export async function recentHotos(campIds: readonly string[], limit = 5) {
  if (!campIds.length) return [];
  return db.select().from(wbShiftEvent).where(inArray(wbShiftEvent.campId, [...campIds])).orderBy(desc(wbShiftEvent.at)).limit(limit);
}

// ------------------------------------------------------------------ weekday camps: an admin's override (2026-10-14)

/**
 * Keep a weekday camp on (or off) against its pattern, for the stretch where
 * the pattern says otherwise (overrideWindow). ADMIN only: the projector
 * switches a GC's own toggle in the web app back. A new override replaces any
 * not yet over for that camp.
 */
export async function keepShift(actor: Actor, campId: string, on: boolean, via: Via, now: Date = new Date()) {
  if (!hasGrant(actor.grants, ["ADMIN"], "any")) return { ok: false as const, error: "Only an admin can keep a camp on or off." };
  const p = (await loadPatterns()).get(campId);
  if (p?.kind !== "WEEKLY") return { ok: false as const, error: "Only a weekday camp (Monday to Friday) can be kept on or off here. Teams that take turns follow their HOTO." };
  const w = overrideWindow(p, now, on);
  if (!w) return { ok: false as const, error: "Its pattern never changes, so there's nothing to override. Change the pattern in Shifts instead." };
  return inTx(async (tx) => {
    await tx
      .update(wbShiftOverride)
      .set({ clearedAt: now, clearedBy: actor.id })
      .where(and(eq(wbShiftOverride.campId, campId), isNull(wbShiftOverride.clearedAt), gt(wbShiftOverride.untilAt, now)));
    const [row] = await tx.insert(wbShiftOverride).values({ campId, on, fromAt: w.startAt, untilAt: w.endAt!, by: actor.id }).returning();
    await wbAudit(tx, { memberId: actor.id, via, action: "keep-shift", entity: "wb_shift_override", entityId: row.id, after: { campId, on, fromAt: w.startAt, untilAt: w.endAt } });
    return row;
  });
}

/** Back to the pattern: the override ends now. */
export async function clearShiftOverride(actor: Actor, overrideId: string, via: Via, now: Date = new Date()) {
  if (!hasGrant(actor.grants, ["ADMIN"], "any")) return { ok: false as const, error: "Only an admin can change that." };
  return inTx(async (tx) => {
    const [row] = await tx
      .update(wbShiftOverride)
      .set({ clearedAt: now, clearedBy: actor.id })
      .where(and(eq(wbShiftOverride.id, overrideId), isNull(wbShiftOverride.clearedAt)))
      .returning({ id: wbShiftOverride.id });
    if (!row) throw new Refusal("That's already been cleared.");
    await wbAudit(tx, { memberId: actor.id, via, action: "clear-keep-shift", entity: "wb_shift_override", entityId: overrideId });
  });
}
