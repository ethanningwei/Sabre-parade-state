import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { place } from "@/lib/wb/format";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbCommanderChat, wbGrant, wbMember, type WbRole } from "@/lib/wb/db/schema";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { gapsReach, inGapsScope } from "@/lib/wb/domain/roster-flow";

// Read models for the Mini App's Admin and Gaps screens.

const selfCamp = alias(camp, "self_camp");
const selfSubunit = alias(subunit, "self_subunit");

export interface MemberRow {
  id: string;
  tgName: string;
  tgUsername: string | null;
  telegramUserId: number;
  registered: boolean;
  active: boolean;
  source: "ROSTER" | "SELF" | null;
  /** "3SG ETHAN TEO" from the roster, or what a SELF sign-up typed */
  label: string;
  where: string;
  /** their platoon and camp, from the roster or what they told us; for scoping Gaps */
  subunitId: string | null;
  campId: string | null;
  personId: string | null;
  personActive: boolean | null;
  /** what a SELF sign-up typed, for Add to roster */
  self: { rank: string | null; name: string | null; role: string | null };
}

export async function listMembers(): Promise<MemberRow[]> {
  const rows = await db
    .select({
      m: wbMember,
      pRank: person.rank,
      pName: person.name,
      pActive: person.active,
      pCamp: camp.name,
      pCampId: camp.id,
      pSub: subunit.name,
      pSubId: subunit.id,
      sCamp: selfCamp.name,
      sCampId: selfCamp.id,
      sSub: selfSubunit.name,
      sSubId: selfSubunit.id,
    })
    .from(wbMember)
    .leftJoin(person, eq(person.id, wbMember.personId))
    .leftJoin(camp, eq(camp.id, person.campId))
    .leftJoin(subunit, eq(subunit.id, camp.subunitId))
    .leftJoin(selfCamp, eq(selfCamp.id, wbMember.selfCampId))
    .leftJoin(selfSubunit, eq(selfSubunit.id, selfCamp.subunitId))
    .orderBy(desc(wbMember.active), asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder), asc(wbMember.tgName));
  return rows.map(({ m, ...r }) => ({
    id: m.id,
    tgName: m.tgName,
    tgUsername: m.tgUsername,
    telegramUserId: m.telegramUserId,
    registered: !!m.registeredAt,
    active: m.active,
    source: m.source,
    label: r.pName ? `${r.pRank} ${r.pName}` : [m.selfRank, m.selfName].filter(Boolean).join(" ") || m.tgName,
    where: place(r.pCamp ?? r.sCamp, r.pSub ?? r.sSub),
    subunitId: r.pSubId ?? r.sSubId,
    campId: r.pCampId ?? r.sCampId,
    personId: m.personId,
    personActive: r.pActive,
    self: { rank: m.selfRank, name: m.selfName, role: m.selfRole },
  }));
}

export interface GrantRowView {
  id: string;
  memberId: string;
  memberLabel: string;
  role: WbRole;
  scope: string;
}

export async function listGrants(): Promise<GrantRowView[]> {
  const rows = await db
    .select({
      id: wbGrant.id,
      memberId: wbGrant.memberId,
      role: wbGrant.role,
      tgName: wbMember.tgName,
      pRank: person.rank,
      pName: person.name,
      selfName: wbMember.selfName,
      subName: subunit.name,
      campName: camp.name,
    })
    .from(wbGrant)
    .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
    .leftJoin(person, eq(person.id, wbMember.personId))
    .leftJoin(subunit, eq(subunit.id, wbGrant.subunitId))
    .leftJoin(camp, eq(camp.id, wbGrant.campId))
    .orderBy(asc(wbMember.tgName), asc(wbGrant.role));
  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    memberLabel: r.pName ? `${r.pRank} ${r.pName}` : (r.selfName ?? r.tgName),
    role: r.role,
    scope: r.campName ?? r.subName ?? "Company",
  }));
}

export interface ChatRow {
  id: string;
  subunitName: string;
  chatId: number;
  threadId: number | null;
  chatTitle: string;
  linkedAt: Date;
}

export async function listCommanderChats(): Promise<ChatRow[]> {
  return db
    .select({
      id: wbCommanderChat.id,
      subunitName: subunit.name,
      chatId: wbCommanderChat.chatId,
      threadId: wbCommanderChat.threadId,
      chatTitle: wbCommanderChat.chatTitle,
      linkedAt: wbCommanderChat.linkedAt,
    })
    .from(wbCommanderChat)
    .innerJoin(subunit, eq(subunit.id, wbCommanderChat.subunitId))
    .orderBy(asc(subunit.sortOrder));
}

// ------------------------------------------------------------------ gaps

export interface Gaps {
  /** on the roster, but nobody has registered as them */
  unregistered: { personId: string; rank: string; name: string; campId: string; campName: string; subunitId: string; subunitName: string }[];
  /** registered themselves (SELF) and not on the roster yet */
  selfOnly: MemberRow[];
  /** registered against a roster person who has since left (inactive) */
  left: MemberRow[];
}

/**
 * Gaps for someone with these grants. A company-wide grant sees the company;
 * a platoon- or camp-scoped one sees only that platoon or camp (213 people
 * was too long to scroll). Unplaced SELF sign-ups are company-wide only.
 */
export async function gapsFor(grants: readonly GrantRow[]): Promise<Gaps & { scoped: boolean }> {
  const g = await gaps();
  if (gapsReach(grants) === true) return { ...g, scoped: false };
  const inScope = (p: { subunitId: string | null; campId: string | null }) => inGapsScope(grants, p);
  return {
    unregistered: g.unregistered.filter(inScope),
    selfOnly: g.selfOnly.filter(inScope),
    left: g.left.filter(inScope),
    scoped: true,
  };
}

/** Registered, not on the roster yet, and in Gaps scope: those to add. */
function waitingWhere(grants: readonly GrantRow[]): SQL | null {
  const reach = gapsReach(grants);
  const base = and(eq(wbMember.active, true), isNotNull(wbMember.registeredAt), isNull(wbMember.personId))!;
  if (reach === true) return base;
  const parts = [
    reach.subunitIds.length ? inArray(selfCamp.subunitId, reach.subunitIds) : null,
    reach.campIds.length ? inArray(wbMember.selfCampId, reach.campIds) : null,
  ].filter((x): x is SQL => !!x);
  return parts.length ? and(base, or(...parts))! : null;
}

/** How many are waiting to be added to the roster in this viewer's Gaps scope (the Home badge): one count, not gaps(). */
export async function waitingCount(grants: readonly GrantRow[]): Promise<number> {
  const where = waitingWhere(grants);
  if (!where) return 0;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wbMember)
    .leftJoin(selfCamp, eq(selfCamp.id, wbMember.selfCampId))
    .where(where);
  return n;
}

/** Per platoon of the camp they registered with: how many have waited since before `before` (the evening line). */
export async function waitingByPlatoon(before: Date): Promise<{ subunitId: string; subunitName: string; n: number }[]> {
  return db
    .select({ subunitId: selfSubunit.id, subunitName: selfSubunit.name, n: sql<number>`count(*)::int` })
    .from(wbMember)
    .innerJoin(selfCamp, eq(selfCamp.id, wbMember.selfCampId))
    .innerJoin(selfSubunit, eq(selfSubunit.id, selfCamp.subunitId))
    .where(and(eq(wbMember.active, true), isNull(wbMember.personId), lt(wbMember.registeredAt, before)))
    .groupBy(selfSubunit.id, selfSubunit.name, selfSubunit.sortOrder)
    .orderBy(asc(selfSubunit.sortOrder));
}

export async function gaps(): Promise<Gaps> {
  const [unregistered, members] = await Promise.all([
    db
      .select({
        personId: person.id,
        rank: person.rank,
        name: person.name,
        campId: camp.id,
        campName: camp.name,
        subunitId: subunit.id,
        subunitName: subunit.name,
      })
      .from(person)
      .innerJoin(camp, eq(camp.id, person.campId))
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .leftJoin(wbMember, eq(wbMember.personId, person.id))
      .where(and(eq(person.active, true), isNull(wbMember.id)))
      .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder)),
    listMembers(),
  ]);
  const live = members.filter((m) => m.active && m.registered);
  return {
    unregistered,
    selfOnly: live.filter((m) => !m.personId),
    left: live.filter((m) => m.personId && m.personActive === false),
  };
}

/** Registered members, for pickers. */
export async function registeredMembers(): Promise<{ id: string; label: string }[]> {
  const rows = await listMembers();
  return rows.filter((m) => m.active && m.registered).map((m) => ({ id: m.id, label: `${m.label}${m.where ? ` · ${m.where}` : ""}` }));
}
