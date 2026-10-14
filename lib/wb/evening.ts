import "server-only";
import { and, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { person, subunit } from "@/lib/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { bootstrapAdminIds } from "@/lib/wb/auth";
import { wbAudit as wbAuditTable, wbCommanderChat, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { recordWhat } from "@/lib/wb/domain/describe";
import { isLive } from "@/lib/wb/domain/rules";
import { addDays, dayRange, todaySgt } from "@/lib/wb/domain/timeline";
import { shortTomorrow } from "@/lib/wb/forecast-data";
import { rangeLabel } from "@/lib/wb/domain/timeline";
import { shortBy } from "@/lib/wb/domain/rf";
import { openRequests } from "@/lib/wb/rf-data";
import { findViews } from "@/lib/wb/records";
import { backData } from "@/lib/wb/domain/projection-kinds";
import { v1End } from "@/lib/wb/domain/projection";
import { dayMonth } from "@/lib/wb/domain/timeline";
import { dueBack, projectionReport, syncProjection } from "@/lib/wb/projection";
import { noticeText, onensData, outcomeButton } from "@/lib/wb/telegram/cards";
import type { Button, Courier } from "@/lib/wb/telegram/courier";

// The evening round, 1900 SGT, once a day (Vercel Hobby allows daily crons).
// Ports Sabre Bot's chase(): nobody needs reminding to come back to camp, but
// ONENS uploads and unanswered requests rot quietly if left alone, an MA is
// the appointment people miss, and a status that lapses says nothing to anyone.
//
// Once a day: an `evening-round` wb_audit row keyed by the date is written
// before anything is sent, so a retry or a second trigger sends nothing.
// `force` (a run by hand) skips that check.

const STALE_MS = 12 * 60 * 60 * 1000;
const CHASE_MS = 24 * 60 * 60 * 1000;
/** Stop chasing an outcome after this: by then the PS has asked in person. */
const CHASE_GIVE_UP_MS = 14 * 24 * 60 * 60 * 1000;

export interface RoundSummary {
  date: string;
  skipped: boolean;
  ending: number;
  tomorrow: number;
  onens: number;
  chased: number;
  digests: number;
  heartbeats: number;
  /** camps below minimum tomorrow (Phase 4) */
  short: number;
  /** RF requests still open */
  rf: number;
  /** "Back?" messages sent to commanders chats (Phase 6, projection on) */
  back: number;
  /** the admin's shadow diff / projection report sent (Phase 6) */
  projection: number;
}

const groupBy = <T, K>(rows: readonly T[], key: (r: T) => K) => {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Claim tonight's round. False if it has already run today. */
async function claim(date: string, force: boolean): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wb-evening-round'))`);
    if (!force) {
      const [done] = await tx
        .select({ id: wbAuditTable.id })
        .from(wbAuditTable)
        .where(and(eq(wbAuditTable.action, "evening-round"), eq(wbAuditTable.entityId, date)));
      if (done) return false;
    }
    await wbAudit(tx, { memberId: null, via: "SYSTEM", action: "evening-round", entity: "wb_evening", entityId: date, after: { force: force || undefined } });
    return true;
  });
}

export async function eveningRound(courier: Courier, now: Date = new Date(), { force = false } = {}): Promise<RoundSummary> {
  const today = todaySgt(now);
  const summary: RoundSummary = { date: today, skipped: false, ending: 0, tomorrow: 0, onens: 0, chased: 0, digests: 0, heartbeats: 0, short: 0, rf: 0, back: 0, projection: 0 };
  if (!(await claim(today, force))) return { ...summary, skipped: true };

  const todayStart = dayRange(today).startAt;
  const tomorrow = dayRange(addDays(today, 1));
  /** one message per platoon, not five: subunitId -> parts */
  const digest = new Map<string, { name: string; parts: string[]; approvals: boolean; rf: boolean }>();
  const addPart = (r: { subunitId: string; subunitName: string }, part: string, button: "approvals" | "rf" | null = null) => {
    const d = digest.get(r.subunitId) ?? { name: r.subunitName, parts: [], approvals: false, rf: false };
    d.parts.push(part);
    if (button) d[button] = true;
    digest.set(r.subunitId, d);
  };

  // ---------------------------------------------------------------- an MC or status ending today
  const ending = await findViews(
    and(inArray(wbRecord.kind, ["MC", "HL", "STATUS"]), eq(wbRecord.state, "RECORDED"), gt(wbRecord.endAt, todayStart), lte(wbRecord.endAt, tomorrow.startAt))!,
  );
  for (const r of ending) if (await courier.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "ending" }))) summary.ending++;
  for (const rows of groupBy(ending, (r) => r.subunitId).values()) {
    addPart(rows[0], [`✅ ${plural(rows.length, "man")} back to full duty tomorrow`, ...rows.map((r) => `• ${r.rank} ${r.name} (${r.campName}): ${recordWhat(r)}`)].join("\n"));
  }

  // ---------------------------------------------------------------- an MA or event tomorrow
  const due = await findViews(
    and(inArray(wbRecord.kind, ["MA", "EVENT"]), inArray(wbRecord.state, ["RECORDED", "APPROVED"]), gte(wbRecord.startAt, tomorrow.startAt), lt(wbRecord.startAt, tomorrow.endAt!))!,
  );
  for (const rows of groupBy(due, (r) => r.personId).values()) {
    if (await courier.send({ telegramId: rows[0].ownerTelegramId }, noticeText(rows[0], { kind: "tomorrow", rows }))) summary.tomorrow++;
  }

  // ---------------------------------------------------------------- ONENS still owed
  const owed = await findViews(and(eq(wbRecord.onens, "OWED"), eq(wbRecord.state, "RECORDED"))!);
  for (const rows of groupBy(owed, (r) => r.personId).values()) {
    const kb: Button[][] = rows.map((r) => [{ text: rows.length === 1 ? "☁️ Uploaded" : `☁️ Uploaded: ${r.kind} ${recordWhat(r).split(" · ")[1] ?? ""}`.trim(), data: onensData(r.id) }]);
    if (await courier.send({ telegramId: rows[0].ownerTelegramId }, noticeText(rows[0], { kind: "onens", rows }), kb)) summary.onens++;
  }

  // ---------------------------------------------------------------- a report sick with no outcome after a day
  const approvedSick = await findViews(
    and(
      inArray(wbRecord.kind, ["RSI", "RSO"]),
      eq(wbRecord.state, "APPROVED"),
      isNull(wbRecord.outcomeAt),
      lt(wbRecord.decidedAt, new Date(now.getTime() - CHASE_MS)),
      gt(wbRecord.decidedAt, new Date(now.getTime() - CHASE_GIVE_UP_MS)),
    )!,
  );
  if (approvedSick.length) {
    const kids = await db
      .select({ parentId: wbRecord.parentId, state: wbRecord.state })
      .from(wbRecord)
      .where(inArray(wbRecord.parentId, approvedSick.map((r) => r.id)));
    const answered = new Set(kids.filter((k) => isLive(k.state)).map((k) => k.parentId));
    for (const r of approvedSick.filter((x) => !answered.has(x.id))) {
      if (await courier.send({ telegramId: r.ownerTelegramId }, noticeText(r, { kind: "chase" }), outcomeButton(r.id))) summary.chased++;
    }
  }

  // ---------------------------------------------------------------- requests waiting more than 12 hours
  const stale = await findViews(and(eq(wbRecord.state, "PENDING"), lt(wbRecord.createdAt, new Date(now.getTime() - STALE_MS)))!);
  for (const rows of groupBy(stale, (r) => r.subunitId).values()) {
    addPart(rows[0], `⏳ ${plural(rows.length, "request")} waiting more than 12 hours`, "approvals");
  }

  // ---------------------------------------------------------------- camps below minimum tomorrow (Phase 4)
  try {
    for (const [subunitId, d] of await shortTomorrow(now)) {
      addPart({ subunitId, subunitName: d.name }, [`⚠️ Below minimum tomorrow`, ...d.lines].join("\n"));
      summary.short += d.lines.length;
    }
  } catch (e) {
    // the rest of the round still goes out
    console.error("wb evening manning:", e);
  }

  // ---------------------------------------------------------------- RF requests still open (Phase 5)
  // each platoon hears about its own camps' requests; COY HQ about all of them
  try {
    const open = await openRequests(now);
    summary.rf = open.length;
    const line = (r: (typeof open)[number]) => `• ${r.campName} ${rangeLabel(r)}: short ${shortBy(r)} of ${r.need}`;
    const [hq] = open.length ? await db.select({ id: subunit.id, name: subunit.name }).from(subunit).where(eq(subunit.isHq, true)) : [];
    for (const rows of groupBy(open.filter((r) => r.subunitId !== hq?.id), (r) => r.subunitId).values()) {
      addPart(rows[0], [`🚌 ${plural(rows.length, "RF request")} still open`, ...rows.map(line)].join("\n"), "rf");
    }
    if (hq) addPart({ subunitId: hq.id, subunitName: hq.name }, [`🚌 ${plural(open.length, "RF request")} still open, company-wide`, ...open.map((r) => `${line(r)} (${r.subunitName})`)].join("\n"), "rf");
  } catch (e) {
    console.error("wb evening rf:", e);
  }

  // ---------------------------------------------------------------- one digest per commanders chat
  for (const [subunitId, d] of digest) {
    const buttons: Button[][] = [...(d.approvals ? [[{ text: "Open Approvals", route: "approvals" }]] : []), ...(d.rf ? [[{ text: "Open the RF board", route: "rf" }]] : [])];
    summary.digests += await courier.send({ platoon: subunitId }, `🌙 Tonight · ${d.name}\n\n${d.parts.join("\n\n")}`, buttons.length ? buttons : undefined);
  }

  // ---------------------------------------------------------------- projection (Phase 6)
  // On: sync, then ask each platoon about everything ending before tomorrow's
  // round, so each closes the moment it ends. Off: the admin's shadow diff.
  try {
    const res = await syncProjection(now);
    if (res.live) {
      const due = await dueBack(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      for (const rows of groupBy(due, (r) => r.subunitId).values()) {
        const line = (r: (typeof rows)[number]) => {
          const end = v1End(r.endAt);
          return `• ${r.rank} ${r.name} (${r.campName}): ${r.what} ${r.endAt.getTime() <= now.getTime() ? "ended" : "to"} ${dayMonth(end.date)}${end.time ? ` ${end.time}` : ""}`;
        };
        const text = [
          `🏠 Back? · ${rows.length} on the parade state`,
          "Tap when he's back. The parade state marks him present once it ends, not before.",
          rows.map(line).join("\n"),
        ].join("\n\n");
        const buttons: Button[][] = rows.map((r) => [{ text: `✅ ${r.rank} ${r.name} back`, data: backData(r.projectionId) }]);
        summary.back += await courier.send({ platoon: rows[0].subunitId }, text, buttons);
      }
    }
    if (bootstrapAdminIds().length) summary.projection = await courier.send({ admins: true }, await projectionReport(res));
  } catch (e) {
    console.error("wb evening projection:", e);
  }

  // ---------------------------------------------------------------- heartbeat, last: one sent before the work would lie
  summary.heartbeats = await heartbeat(courier, now, summary);
  return summary;
}

/**
 * Proof of life to the admins. A dead man's switch: the alarm is the evening
 * it doesn't arrive, because a bot that has stopped can't say so.
 */
async function heartbeat(courier: Courier, now: Date, s: RoundSummary): Promise<number> {
  if (!bootstrapAdminIds().length) return 0;
  const since = dayRange(todaySgt(now)).startAt;
  const [[roster], [registered], [pending], [today], [linked], [platoons]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(person).where(eq(person.active, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(wbMember).where(and(eq(wbMember.active, true), sql`${wbMember.registeredAt} is not null`)),
    db.select({ n: sql<number>`count(*)::int` }).from(wbRecord).where(eq(wbRecord.state, "PENDING")),
    db.select({ n: sql<number>`count(*)::int` }).from(wbRecord).where(gte(wbRecord.createdAt, since)),
    db.select({ n: sql<number>`count(*)::int` }).from(wbCommanderChat),
    db.select({ n: sql<number>`count(*)::int` }).from(subunit).where(eq(subunit.isHq, false)),
  ]);
  const text =
    `💓 Still here\n\n` +
    `${roster.n} on the roster · ${registered.n} registered\n` +
    `${pending.n} waiting on a decision · ${today.n} recorded today\n` +
    `${linked.n} commanders chats linked (${platoons.n} platoons)\n` +
    `Tonight: ${s.ending} ending, ${s.tomorrow} tomorrow, ${s.onens} ONENS, ${s.chased} chased, ${s.short} below minimum, ${s.rf} RF open, ${s.digests} digests, ${s.back} Back? messages\n\n` +
    "Sent every evening. If an evening goes by without one, the bot isn't running.";
  return courier.send({ admins: true }, text);
}
