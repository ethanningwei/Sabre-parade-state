import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { place } from "@/lib/wb/format";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbCommanderChat, wbGrant, wbMember, type WbRole } from "@/lib/wb/db/schema";
import { inReach, reach, reachLabel, type GrantRow } from "@/lib/wb/domain/access";
import { reachWhere } from "@/lib/wb/reach-sql";

// Read models for the Mini App's Admin and Roster screens.

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
  /** their platoon and camp, from the roster or what they told us; for scoping Roster */
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

// ------------------------------------------------------------------ roster

export interface RosterRow {
  personId: string;
  rank: string;
  name: string;
  /** as v1 has it: free text from the old roster, or one of rolesFor() */
  role: string;
  /** someone has registered as him */
  registered: boolean;
}

export interface RosterCamp {
  id: string;
  name: string;
  subunitId: string;
  subunitName: string;
  isHq: boolean;
  people: RosterRow[];
}

export interface Roster {
  /** "Your camp", "Your platoon", "The whole company" */
  reach: string;
  /** every camp in scope, in parade-state order, empty ones too (a man can be added to them) */
  camps: RosterCamp[];
  /** registered themselves and not on the roster yet: Add to roster / Link to existing */
  waiting: MemberRow[];
  /** registered against a roster person who has since left */
  left: MemberRow[];
}

/** The Roster screen for someone with these grants: the same scope as the waiting accounts. `hidden`: the camps a switch to ROT left out. */
export async function rosterFor(grants: readonly GrantRow[], hidden: ReadonlySet<string> = new Set()): Promise<Roster> {
  const [people, members, allCamps] = await Promise.all([
    db
      .select({ personId: person.id, rank: person.rank, name: person.name, role: person.role, campId: person.campId, memberId: wbMember.id })
      .from(person)
      .innerJoin(camp, eq(camp.id, person.campId))
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .leftJoin(wbMember, eq(wbMember.personId, person.id))
      .where(eq(person.active, true))
      .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder), asc(person.sortOrder)),
    listMembers(),
    db
      .select({ id: camp.id, name: camp.name, subunitId: subunit.id, subunitName: subunit.name, isHq: subunit.isHq })
      .from(camp)
      .innerJoin(subunit, eq(subunit.id, camp.subunitId))
      .orderBy(asc(subunit.sortOrder), asc(camp.sortOrder)),
  ]);
  const roster = reach({ grants }, "roster");
  const camps = new Map<string, RosterCamp>();
  for (const c of allCamps) if (!hidden.has(c.id) && inReach(roster, { subunitId: c.subunitId, campId: c.id })) camps.set(c.id, { ...c, people: [] });
  for (const p of people) camps.get(p.campId)?.people.push({ personId: p.personId, rank: p.rank, name: p.name, role: p.role, registered: !!p.memberId });
  const live = members.filter((m) => m.active && m.registered && inReach(roster, m));
  return {
    reach: reachLabel(roster),
    camps: [...camps.values()],
    waiting: live.filter((m) => !m.personId),
    left: live.filter((m) => m.personId && m.personActive === false),
  };
}

/** Each section's SC (ROT): an SC grant on that camp, by his roster name. */
export async function sectionCommanders(): Promise<Map<string, string>> {
  const rows = await db
    .select({ campId: wbGrant.campId, rank: person.rank, name: person.name, tgName: wbMember.tgName })
    .from(wbGrant)
    .innerJoin(wbMember, eq(wbMember.id, wbGrant.memberId))
    .leftJoin(person, eq(person.id, wbMember.personId))
    .where(and(eq(wbGrant.role, "SC"), isNotNull(wbGrant.campId), eq(wbMember.active, true)))
    .orderBy(asc(wbGrant.grantedAt));
  const out = new Map<string, string>();
  for (const r of rows) if (r.campId && !out.has(r.campId)) out.set(r.campId, r.name ? `${r.rank} ${r.name}` : r.tgName);
  return out;
}

/** How many are waiting to be added to the roster in this viewer's Roster scope (the Home badge): one count, not rosterFor(). */
export async function waitingCount(grants: readonly GrantRow[]): Promise<number> {
  // registered, not on the roster yet, and by the camp they registered with, in Roster reach (as rosterFor's waiting)
  const where = and(
    eq(wbMember.active, true),
    isNotNull(wbMember.registeredAt),
    isNull(wbMember.personId),
    reachWhere(reach({ grants }, "roster"), { subunitId: selfCamp.subunitId, campId: wbMember.selfCampId }),
  );
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

/** Registered members, for pickers. */
export async function registeredMembers(): Promise<{ id: string; label: string }[]> {
  const rows = await listMembers();
  return rows.filter((m) => m.active && m.registered).map((m) => ({ id: m.id, label: `${m.label}${m.where ? ` · ${m.where}` : ""}` }));
}
