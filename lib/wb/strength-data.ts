import "server-only";
import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { camp, coy } from "@/lib/db/schema";
import { loadSnapshot } from "@/lib/data/snapshot";
import { toSgt } from "@/lib/parade/time";
import { wbRecord } from "@/lib/wb/db/schema";
import { dayRange, statusReason, v1Covers, v1CoversDay, v1Reason, withRange, type StrengthMan } from "@/lib/wb/domain/strength-list";
import { dayRange as wholeDay, todaySgt } from "@/lib/wb/domain/timeline";
import { assignmentRows, campsInfo, type CampInfo } from "@/lib/wb/forecast-data";

// The strength list's read (slice 1 of docs/conducts-plan.md): one camp's men
// in roster order, with why Sabre thinks each isn't going, at this moment.
// Nothing is saved. Reasons, first that applies:
//   1. an approved or recorded absence on the timeline (AL, MC, MA, an event…);
//   2. Extra or RF at another camp;
//   3. what the parade state says (a GC's own entry: a course, MP60);
//   4. a report sick today with no outcome yet (RSI, RSO).
// A live status (LD) is kept apart: he's there but not taking part.
// A named list (slice 3) asks the same of a whole day ahead: anything that
// touches that day, and a pending absence too, flagged as pending.

const sgt = (at: Date) => toSgt(at);
const range = (r: { startAt: Date; endAt: Date | null }) => dayRange(sgt(r.startAt), r.endAt ? sgt(r.endAt) : null);

export interface StrengthCamp {
  info: CampInfo;
  men: StrengthMan[];
}

/** The camp's men now, or null if it isn't a camp of a coy. */
export const strengthFor = (campId: string, now: Date = new Date()) => menIn(campId, { now });

/** The camp's men on that day (a named list's warnings), or null if it isn't a camp of a coy. */
export const strengthOn = (campId: string, date: string, now: Date = new Date()) => menIn(campId, { now, day: date });

async function menIn(campId: string, when: { now: Date; day?: string }): Promise<StrengthCamp | null> {
  const { now, day } = when;
  const info = (await campsInfo()).find((c) => c.id === campId);
  if (!info) return null;
  const [owner] = await db.select({ c: coy }).from(coy).innerJoin(camp, eq(camp.coyId, coy.id)).where(eq(camp.id, campId)).limit(1);
  if (!owner) return null;
  const snapshot = await loadSnapshot(owner.c);
  const people = snapshot.subunits.flatMap((s) => s.camps).find((c) => c.id === campId)?.people ?? [];
  if (!people.length) return { info, men: [] };
  const ids = people.map((p) => p.id);
  // now: one instant; a day: all of it
  const whole = day ? wholeDay(day) : null;
  const span = { startAt: whole?.startAt ?? now, endAt: whole?.endAt ?? new Date(now.getTime() + 1) };

  const live = or(isNull(wbRecord.endAt), gt(wbRecord.endAt, span.startAt));
  const [records, assignments] = await Promise.all([
    db
      .select({
        personId: wbRecord.personId,
        kind: wbRecord.kind,
        state: wbRecord.state,
        absent: wbRecord.absent,
        startAt: wbRecord.startAt,
        endAt: wbRecord.endAt,
        detail: wbRecord.detail,
        location: wbRecord.location,
        outcomeAt: wbRecord.outcomeAt,
      })
      .from(wbRecord)
      .where(and(inArray(wbRecord.personId, ids), inArray(wbRecord.state, ["PENDING", "APPROVED", "RECORDED"]), lt(wbRecord.startAt, span.endAt), live)),
    assignmentRows(span),
  ]);
  const today = todaySgt(now);
  const sgtNow = sgt(now);

  const men = people.map((p): StrengthMan => {
    const mine = records.filter((r) => r.personId === p.id);
    const standing = mine.find((r) => r.absent && r.state !== "PENDING");
    const sent = assignments.find((a) => a.personId === p.id && a.type !== "SOL" && a.campId !== campId);
    const asked = day ? mine.find((r) => r.absent && r.state === "PENDING" && r.kind !== "RSI" && r.kind !== "RSO") : undefined;
    const sick = (!day || day === today) && mine.find((r) => (r.kind === "RSI" || r.kind === "RSO") && r.state !== "RECORDED" && !r.outcomeAt && sgt(r.startAt).date === today);
    const status = mine.find((r) => r.kind === "STATUS" && r.state === "RECORDED");
    let away: string | null = null;
    if (standing) away = timelineReason(standing);
    else if (sent) away = withRange(sent.type, range(sent));
    else if (p.absence && (day ? v1CoversDay(p.absence, day, today) : v1Covers(p.absence, sgtNow))) away = v1Reason(p.absence);
    else if (asked) away = `${timelineReason(asked)} pending`;
    else if (sick) away = sick.kind;
    return {
      personId: p.id,
      rank: p.rank,
      name: p.name,
      role: p.role,
      away,
      status: status ? statusReason(status.detail, status.endAt ? range(status) : "") : null,
    };
  });
  return { info, men };
}

function timelineReason(r: { kind: string; startAt: Date; endAt: Date | null; detail: string; location: string }): string {
  if (r.kind === "MA") return r.location ? `MA @${r.location.trim().toUpperCase()}` : "MA";
  // an event's detail is "IPPT @ KC3 0800-1200H": the lists keep the what
  if (r.kind === "EVENT") return withRange(r.detail.split(" @ ")[0].trim().toUpperCase() || "EVENT", range(r));
  return withRange(r.kind, range(r));
}
