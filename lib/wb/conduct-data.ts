import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { coy, person } from "@/lib/db/schema";
import { wbConduct, wbConductCamp, wbConductMan, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { isCampCommander, type GrantRow } from "@/lib/wb/domain/access";
import type { CampReport, ConductState } from "@/lib/wb/domain/conducts";
import type { StrengthTap } from "@/lib/wb/domain/strength-list";
import { addDays } from "@/lib/wb/domain/timeline";
import { campsInfo, type CampInfo } from "@/lib/wb/forecast-data";
import type { Db } from "@/lib/wb/records";

// Conducts' reads (slice 2 of docs/conducts-plan.md): the list, one conduct's
// roll-up, one camp's send screen, whom to DM, and Needs you's line.

export interface Conduct {
  id: string;
  title: string;
  date: string;
  reportBy: string;
  state: ConductState;
}

export interface ConductCamp extends CampReport {
  id: string;
  subunitId: string;
}

const cols = { id: wbConduct.id, title: wbConduct.title, date: wbConduct.date, reportBy: wbConduct.reportBy, state: wbConduct.state };

/** The coy conducts belong to: the first by key, as the phase is (lib/wb/phase.ts). Production has one. */
export async function conductCoyId(tx: Db = db): Promise<string | null> {
  const [c] = await tx.select({ id: coy.id }).from(coy).orderBy(asc(coy.key)).limit(1);
  return c?.id ?? null;
}

/** The camps' own commanders (GC, SC) with a Telegram account: whom a conduct asks. */
export async function campGcs(campIds: readonly string[], tx: Db = db): Promise<{ campId: string; telegramUserId: number }[]> {
  if (!campIds.length) return [];
  const rows = await tx
    .select({ campId: wbGrant.campId, telegramUserId: wbMember.telegramUserId })
    .from(wbGrant)
    .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
    .where(and(inArray(wbGrant.role, ["GC", "SC"]), inArray(wbGrant.campId, [...campIds]), eq(wbMember.active, true)))
    .orderBy(asc(wbGrant.grantedAt));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const key = `${r.campId}:${r.telegramUserId}`;
    if (!r.campId || seen.has(key)) return [];
    seen.add(key);
    return [{ campId: r.campId, telegramUserId: r.telegramUserId }];
  });
}

/** Today's and upcoming conducts first (soonest first), then the last week's, with how many camps have sent. */
export async function conductsList(today: string): Promise<(Conduct & { sent: number; camps: number })[]> {
  const conducts = await db
    .select(cols)
    .from(wbConduct)
    .where(gte(wbConduct.date, addDays(today, -7)))
    .orderBy(desc(wbConduct.date), desc(wbConduct.createdAt));
  if (!conducts.length) return [];
  const camps = await db
    .select({ conductId: wbConductCamp.conductId, reportedAt: wbConductCamp.reportedAt })
    .from(wbConductCamp)
    .where(inArray(wbConductCamp.conductId, conducts.map((c) => c.id)));
  const rows = conducts.map((c) => {
    const mine = camps.filter((x) => x.conductId === c.id);
    return { ...c, sent: mine.filter((x) => x.reportedAt).length, camps: mine.length };
  });
  const ahead = rows.filter((c) => c.date >= today).reverse();
  return [...ahead, ...rows.filter((c) => c.date < today)];
}

/** "3SG JAYVEN", or his Telegram name before he's on the roster. */
async function labels(memberIds: readonly string[]): Promise<Map<string, string>> {
  if (!memberIds.length) return new Map();
  const rows = await db
    .select({ id: wbMember.id, rank: person.rank, name: person.name, tgName: wbMember.tgName })
    .from(wbMember)
    .leftJoin(person, eq(person.id, wbMember.personId))
    .where(inArray(wbMember.id, [...memberIds]));
  return new Map(rows.map((r) => [r.id, r.name ? `${r.rank} ${r.name}` : r.tgName]));
}

/** One conduct and every camp in it, parade-state order, with what each sent. */
export async function conductView(id: string): Promise<{ conduct: Conduct; camps: ConductCamp[] } | null> {
  const [conduct] = await db.select(cols).from(wbConduct).where(eq(wbConduct.id, id));
  if (!conduct) return null;
  const [info, rows] = await Promise.all([campsInfo(), db.select().from(wbConductCamp).where(eq(wbConductCamp.conductId, id))]);
  const men = rows.length
    ? await db
        .select()
        .from(wbConductMan)
        .where(inArray(wbConductMan.conductCampId, rows.map((r) => r.id)))
        .orderBy(asc(wbConductMan.sortOrder))
    : [];
  const by = await labels(rows.flatMap((r) => (r.reportedBy ? [r.reportedBy] : [])));
  const camps = info.flatMap((c): ConductCamp[] => {
    const r = rows.find((x) => x.campId === c.id);
    if (!r) return [];
    return [
      {
        id: r.id,
        campId: c.id,
        campName: c.name,
        subunitId: c.subunitId,
        reportedAt: r.reportedAt,
        reportedBy: r.reportedBy ? (by.get(r.reportedBy) ?? null) : null,
        going: r.going,
        total: r.total,
        nudgedAt: r.nudgedAt,
        men: men.filter((m) => m.conductCampId === r.id),
      },
    ];
  });
  return { conduct, camps };
}

/** A camp's send screen: the conduct, the camp, and the GC's taps from his last send (so Send again starts from them). */
export async function conductCampView(
  id: string,
): Promise<{ conduct: Conduct; camp: CampInfo; reportedAt: Date | null; reportedBy: string | null; posted: boolean; taps: Record<string, StrengthTap> } | null> {
  const [row] = await db.select().from(wbConductCamp).where(eq(wbConductCamp.id, id));
  if (!row) return null;
  const [[conduct], info] = await Promise.all([db.select(cols).from(wbConduct).where(eq(wbConduct.id, row.conductId)), campsInfo()]);
  const camp = info.find((c) => c.id === row.campId);
  if (!conduct || !camp) return null;
  const tapped = await db
    .select({ personId: wbConductMan.personId, going: wbConductMan.going, reason: wbConductMan.reason })
    .from(wbConductMan)
    .where(and(eq(wbConductMan.conductCampId, id), eq(wbConductMan.source, "tap")));
  const taps: Record<string, StrengthTap> = {};
  for (const t of tapped) taps[t.personId] = t.going ? { going: true } : { going: false, reason: t.reason ?? "" };
  const by = row.reportedBy ? (await labels([row.reportedBy])).get(row.reportedBy) ?? null : null;
  return { conduct, camp, reportedAt: row.reportedAt, reportedBy: by, posted: row.messageId !== null, taps };
}

/** Needs you: today's open conducts still waiting for a camp this member commands (GC, SC). */
export async function openReportsFor(viewer: { grants: readonly GrantRow[] }, today: string): Promise<{ id: string; title: string; campName: string; reportBy: string }[]> {
  if (!viewer.grants.some((g) => (g.role === "GC" || g.role === "SC") && g.campId)) return [];
  const rows = await db
    .select({ id: wbConductCamp.id, campId: wbConductCamp.campId, title: wbConduct.title, reportBy: wbConduct.reportBy })
    .from(wbConductCamp)
    .innerJoin(wbConduct, eq(wbConduct.id, wbConductCamp.conductId))
    .where(and(eq(wbConduct.date, today), eq(wbConduct.state, "OPEN"), isNull(wbConductCamp.reportedAt)))
    .orderBy(asc(wbConduct.reportBy));
  if (!rows.length) return [];
  const info = await campsInfo();
  return rows.flatMap((r) => {
    const c = info.find((x) => x.id === r.campId);
    return c && isCampCommander(viewer, { subunitId: c.subunitId, campId: c.id }) ? [{ id: r.id, title: r.title, campName: c.name, reportBy: r.reportBy }] : [];
  });
}

/** The camps still waiting in an open conduct, for a cancel's DMs. */
export async function waitingCamps(conductId: string, tx: Db = db): Promise<{ campId: string }[]> {
  return tx
    .select({ campId: wbConductCamp.campId })
    .from(wbConductCamp)
    .where(and(eq(wbConductCamp.conductId, conductId), isNull(wbConductCamp.reportedAt)));
}
