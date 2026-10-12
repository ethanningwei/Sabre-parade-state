import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbCommanderChat, wbGrant, wbMember, type WbRole } from "@/lib/wb/db/schema";

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
  personId: string | null;
  personActive: boolean | null;
}

export async function listMembers(): Promise<MemberRow[]> {
  const rows = await db
    .select({
      m: wbMember,
      pRank: person.rank,
      pName: person.name,
      pActive: person.active,
      pCamp: camp.name,
      pSub: subunit.name,
      sCamp: selfCamp.name,
      sSub: selfSubunit.name,
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
    where: [r.pCamp ?? r.sCamp, r.pSub ?? r.sSub].filter(Boolean).join(" · "),
    personId: m.personId,
    personActive: r.pActive,
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
  unregistered: { personId: string; rank: string; name: string; campName: string; subunitName: string }[];
  /** registered themselves (SELF) and not on the roster yet */
  selfOnly: MemberRow[];
  /** registered against a roster person who has since left (inactive) */
  left: MemberRow[];
}

export async function gaps(): Promise<Gaps> {
  const [unregistered, members] = await Promise.all([
    db
      .select({ personId: person.id, rank: person.rank, name: person.name, campName: camp.name, subunitName: subunit.name })
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
