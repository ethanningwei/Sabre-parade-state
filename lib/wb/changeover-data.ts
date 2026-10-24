import "server-only";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getCoy, loadSnapshot, type CoyRow } from "@/lib/data/snapshot";
import { db } from "@/lib/db";
import { camp, duty, person, subunit } from "@/lib/db/schema";
import { validate, type CoySnapshot, type Issue } from "@/lib/parade";
import { currentCaa } from "@/lib/parade/time";
import { renderRotParadeState } from "@/lib/parade/render-rot";
import { wbAssignment, wbCommanderChat, wbDraftGrant, wbDraftPlacement, wbDraftPlatoon, wbDraftSection, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { screens, type GrantRow } from "@/lib/wb/domain/access";
import { roleOf } from "@/lib/wb/domain/roles";
import { matchPasted, parsePastedList, type PoolPerson } from "@/lib/wb/domain/paste";
import { draftSnapshot, isSvc, type DraftPlatoon } from "@/lib/wb/domain/rot";
import { phaseState, type PhaseState } from "@/lib/wb/phase";
import type { Db } from "@/lib/wb/records";

// The changeover's reads: the draft (platoons, sections, drafted commanders),
// every man who needs a section, and the preview. The writes are in
// lib/wb/changeover.ts.

/** Anyone in COY HQ, and admins (phases-plan §3: there are no drivers or storemen). */
export async function runsChangeover(m: { personId: string | null; grants: readonly GrantRow[] }, tx: Db = db): Promise<boolean> {
  if (screens(m).admin) return true;
  if (!m.personId) return false;
  const [row] = await tx
    .select({ isHq: subunit.isHq })
    .from(person)
    .innerJoin(camp, eq(camp.id, person.campId))
    .innerJoin(subunit, eq(subunit.id, camp.subunitId))
    .where(and(eq(person.id, m.personId), eq(person.active, true)));
  return !!row?.isHq;
}

export interface DraftCommander {
  draftGrantId: string;
  personId: string;
  label: string;
  /** has a Sabre account, so the switch can give him the role */
  registered: boolean;
}

export interface DraftMan {
  personId: string;
  rank: string;
  name: string;
  /** his role in Sabre Bot's words: GC, ST CBT, ST SVC */
  role: string;
  campId: string;
  campName: string;
  subunitName: string;
  /** null: not placed yet */
  sectionId: string | null;
  svc: boolean;
}

export interface DraftSectionView {
  id: string;
  name: string;
  campId: string | null;
  men: DraftMan[];
  sc: DraftCommander | null;
}

export interface DraftPlatoonView {
  id: string;
  name: string;
  subunitId: string | null;
  sections: DraftSectionView[];
  pc: DraftCommander | null;
  ps: DraftCommander[];
  /** a commanders chat kept from an earlier switch, or linked to its platoon now */
  chatTitle: string | null;
}

export interface HqPerson {
  personId: string;
  label: string;
  role: string;
}

export interface Draft {
  coy: CoyRow;
  phase: PhaseState;
  /** today's snapshot as v1 loads it (Vigilance's, before the switch) */
  snapshot: CoySnapshot;
  platoons: DraftPlatoonView[];
  /** every man outside COY HQ, in roster order: combat troopers to place, SVC troopers leaving */
  men: DraftMan[];
  hq: HqPerson[];
}

/** The draft and everyone it's about, for one coy (the MVP's one). */
export async function loadDraft(coyRow?: CoyRow): Promise<Draft> {
  const coy = coyRow ?? (await getCoy());
  const [phase, snapshot, platoons] = await Promise.all([
    phaseState(coy.id),
    loadSnapshot(coy),
    db.select().from(wbDraftPlatoon).where(eq(wbDraftPlatoon.coyId, coy.id)).orderBy(asc(wbDraftPlatoon.sortOrder), asc(wbDraftPlatoon.createdAt)),
  ]);
  const platoonIds = platoons.map((p) => p.id);
  const sections = platoonIds.length
    ? await db.select().from(wbDraftSection).where(inArray(wbDraftSection.platoonId, platoonIds)).orderBy(asc(wbDraftSection.sortOrder), asc(wbDraftSection.createdAt))
    : [];
  const sectionIds = sections.map((s) => s.id);
  const [placements, grants, chats] = await Promise.all([
    sectionIds.length ? db.select().from(wbDraftPlacement).where(inArray(wbDraftPlacement.sectionId, sectionIds)) : [],
    platoonIds.length
      ? db
          .select({ g: wbDraftGrant, rank: person.rank, name: person.name, memberId: wbMember.id, active: wbMember.active, registeredAt: wbMember.registeredAt })
          .from(wbDraftGrant)
          .innerJoin(person, eq(person.id, wbDraftGrant.personId))
          .leftJoin(wbMember, eq(wbMember.personId, wbDraftGrant.personId))
          .where(or(inArray(wbDraftGrant.platoonId, platoonIds), sectionIds.length ? inArray(wbDraftGrant.sectionId, sectionIds) : undefined))
          .orderBy(asc(wbDraftGrant.createdAt))
      : [],
    db.select({ subunitId: wbCommanderChat.subunitId, title: wbCommanderChat.chatTitle }).from(wbCommanderChat),
  ]);

  const placedIn = new Map(placements.map((p) => [p.personId, p.sectionId]));
  const men: DraftMan[] = [];
  const hq: HqPerson[] = [];
  for (const sub of snapshot.subunits) {
    for (const c of sub.camps) {
      for (const p of c.people) {
        if (sub.isHq) {
          hq.push({ personId: p.id, label: `${p.rank} ${p.name}`, role: roleOf(p.role) });
          continue;
        }
        men.push({ personId: p.id, rank: p.rank, name: p.name, role: roleOf(p.role), campId: c.id, campName: c.name, subunitName: sub.name, sectionId: placedIn.get(p.id) ?? null, svc: isSvc(p.role) });
      }
    }
  }
  const commander = (r: (typeof grants)[number]): DraftCommander => ({
    draftGrantId: r.g.id,
    personId: r.g.personId,
    label: `${r.rank} ${r.name}`,
    registered: !!r.memberId && !!r.active && !!r.registeredAt,
  });
  const chatOf = new Map(chats.map((c) => [c.subunitId, c.title]));
  return {
    coy,
    phase,
    snapshot,
    men,
    hq,
    platoons: platoons.map((pl) => ({
      id: pl.id,
      name: pl.name,
      subunitId: pl.subunitId,
      chatTitle: (pl.subunitId && chatOf.get(pl.subunitId)) || pl.chatTitle || null,
      pc: grants.filter((r) => r.g.platoonId === pl.id && r.g.role === "PC").map(commander)[0] ?? null,
      ps: grants.filter((r) => r.g.platoonId === pl.id && r.g.role === "PS").map(commander),
      sections: sections
        .filter((s) => s.platoonId === pl.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          campId: s.campId,
          men: men.filter((m) => m.sectionId === s.id),
          sc: grants.filter((r) => r.g.sectionId === s.id && r.g.role === "SC").map(commander)[0] ?? null,
        })),
    })),
  };
}

/** The drafted structure as the pure rules take it. */
export const draftPlatoons = (d: Draft): DraftPlatoon[] =>
  d.platoons.map((pl) => ({
    id: pl.id,
    name: pl.name,
    sections: pl.sections.map((s) => ({ id: s.id, name: s.name, personIds: s.men.map((m) => m.personId), scIds: s.sc ? [s.sc.personId] : [] })),
  }));

export interface Checklist {
  platoons: number;
  sections: number;
  /** combat troopers placed / to place */
  placed: number;
  toPlace: number;
  sectionsWithSc: number;
  platoonsWithPcPs: number;
  /** drafted commanders with no Sabre account: the switch can't give them their role */
  unregistered: string[];
  svc: number;
  /** Switch to ROT unlocks */
  ready: boolean;
  /** why not, in words */
  blockers: string[];
}

export function checklist(d: Draft): Checklist {
  const toPlace = d.men.filter((m) => !m.svc);
  const placed = toPlace.filter((m) => m.sectionId).length;
  const sections = d.platoons.flatMap((p) => p.sections);
  const commanders = d.platoons.flatMap((p) => [...(p.pc ? [p.pc] : []), ...p.ps, ...p.sections.flatMap((s) => (s.sc ? [s.sc] : []))]);
  const blockers: string[] = [];
  if (!d.platoons.length) blockers.push("No platoons drafted yet.");
  const empty = d.platoons.filter((p) => !p.sections.length).map((p) => p.name);
  if (empty.length) blockers.push(`${empty.join(", ")} ${empty.length === 1 ? "has" : "have"} no sections.`);
  const emptySections = d.platoons.flatMap((p) => p.sections.filter((s) => !s.men.length).map((s) => `${p.name} ${s.name}`));
  if (emptySections.length) blockers.push(`Nobody in ${emptySections.join(", ")}: place men or delete it.`);
  if (placed < toPlace.length) blockers.push(`${toPlace.length - placed} men still need a section.`);
  // v1 allows one of a name per camp
  for (const p of d.platoons)
    for (const s of p.sections) {
      const twice = [...new Set(s.men.map((m) => m.name.trim()).filter((n, i, all) => all.indexOf(n) !== i))];
      if (twice.length) blockers.push(`Two men called ${twice.join(", ")} in ${p.name} ${s.name}: put one in another section, or tell them apart on Roster.`);
    }
  return {
    platoons: d.platoons.length,
    sections: sections.length,
    placed,
    toPlace: toPlace.length,
    sectionsWithSc: sections.filter((s) => s.sc).length,
    platoonsWithPcPs: d.platoons.filter((p) => p.pc && p.ps.length).length,
    unregistered: commanders.filter((c) => !c.registered).map((c) => c.label),
    svc: d.men.filter((m) => m.svc).length,
    ready: d.phase.phase === "VIGILANCE" && blockers.length === 0,
    blockers,
  };
}

export interface Preview {
  text: string;
  unplaced: number;
  issues: Issue[];
}

/** The ROT parade state as it would print now, from the draft. Nothing is saved or sent. */
export function preview(d: Draft, now: Date = new Date()): Preview {
  const caa = currentCaa(now);
  const { snapshot, unplaced } = draftSnapshot(d.snapshot, draftPlatoons(d));
  return { text: renderRotParadeState(snapshot, caa), unplaced: unplaced - d.men.filter((m) => m.svc).length, issues: validate(snapshot, caa) };
}


// ------------------------------------------------------------------ the pasted list

export interface PasteCandidate {
  personId: string;
  label: string;
  campName: string;
}

export interface PasteCheck {
  read: number;
  platoons: number;
  sections: number;
  matched: { line: number; raw: string; person: PasteCandidate; platoon: string; section: string; sc: boolean }[];
  unsure: { line: number; raw: string; platoon: string; section: string; sc: boolean; people: PasteCandidate[]; tooMany?: number }[];
  missing: { line: number; raw: string; platoon: string; section: string }[];
  skipped: { raw: string; label: string; why: "svc" | "hq" | "twice" }[];
  /** names under a platoon with no section header above them */
  homeless: string[];
  /** platoons and sections the list names that the draft doesn't have yet */
  newStructure: string[];
  /** combat troopers who'd still have no section once this is assigned */
  stillUnplaced: string[];
}

/** v1 names can carry stray spaces ("JOSEPH "): matched as typed in the list. */
const tidy = (name: string) => name.trim().split(/\s+/).join(" ");

/** Read a pasted Telegram list against the roster (everyone loaded once). Saves nothing. */
export function checkPaste(d: Draft, text: string): PasteCheck {
  const list = parsePastedList(text);
  const pool: (PoolPerson & { label: string })[] = [
    ...d.men.map((m) => ({ personId: m.personId, name: tidy(m.name), rank: m.rank, campName: m.campName, skip: m.svc ? ("svc" as const) : null, linkedMemberId: null, label: `${m.rank} ${m.name}` })),
    ...d.hq.map((h) => {
      const [rank, ...rest] = h.label.split(" ");
      return { personId: h.personId, name: tidy(rest.join(" ")), rank, campName: "COY HQ", skip: "hq" as const, linkedMemberId: null, label: h.label };
    }),
  ];
  const cand = (p: (typeof pool)[number]): PasteCandidate => ({ personId: p.personId, label: p.label, campName: p.campName });
  const out: PasteCheck = {
    read: list.names.length,
    platoons: list.structure.length,
    sections: list.structure.reduce((n, p) => n + p.sections.length, 0),
    matched: [],
    unsure: [],
    missing: [],
    skipped: [],
    homeless: list.homeless,
    newStructure: [],
    stillUnplaced: [],
  };
  for (const { name, verdict } of matchPasted(list, pool)) {
    const where = { line: name.line, raw: name.raw, platoon: name.platoon, section: name.section };
    if (verdict.kind === "matched") out.matched.push({ ...where, person: cand(verdict.person), sc: name.sc });
    else if (verdict.kind === "unsure") out.unsure.push({ ...where, sc: name.sc, people: verdict.people.filter((p) => !p.skip).map(cand), tooMany: verdict.tooMany });
    else if (verdict.kind === "missing") out.missing.push(where);
    else out.skipped.push({ raw: name.raw, label: verdict.person.label, why: verdict.why });
  }
  for (const p of list.structure) {
    const drafted = d.platoons.find((x) => x.name === p.platoon);
    if (!drafted) out.newStructure.push(p.platoon);
    for (const s of p.sections) if (!drafted?.sections.some((x) => x.name === s)) out.newStructure.push(`${p.platoon} ${s}`);
  }
  const named = new Set(out.matched.map((m) => m.person.personId));
  out.stillUnplaced = d.men.filter((m) => !m.svc && !m.sectionId && !named.has(m.personId)).map((m) => `${m.rank} ${m.name}`);
  return out;
}


// ------------------------------------------------------------------ the Switch sheet

export interface SwitchPreview {
  men: number;
  camps: number;
  extras: number;
  svc: number;
  /** GC grants, and the Vigilance platoons' PC/PS grants */
  grantsOut: number;
  /** drafted SC/PC/PS with an account */
  grantsIn: number;
}

/** What Switch to ROT would do, in counts, for its confirmation sheet (mockup 7). */
export async function switchPreview(d: Draft, now: Date = new Date()): Promise<SwitchPreview> {
  const platoonIds = d.snapshot.subunits.filter((s) => !s.isHq).map((s) => s.id);
  const campIds = d.snapshot.subunits.filter((s) => !s.isHq).flatMap((s) => s.camps.map((c) => c.id));
  const n = sql<number>`count(*)::int`;
  const [[assignments], [duties], [grants]] = await Promise.all([
    campIds.length ? db.select({ n }).from(wbAssignment).where(and(eq(wbAssignment.state, "ACTIVE"), gt(wbAssignment.endAt, now), inArray(wbAssignment.campId, campIds))) : [{ n: 0 }],
    db.select({ n }).from(duty).where(and(eq(duty.coyId, d.coy.id), isNull(duty.closedAt))),
    db.select({ n }).from(wbGrant).where(or(eq(wbGrant.role, "GC"), and(inArray(wbGrant.role, ["PC", "PS"]), inArray(wbGrant.subunitId, platoonIds)))),
  ]);
  const commanders = d.platoons.flatMap((p) => [...(p.pc ? [p.pc] : []), ...p.ps, ...p.sections.flatMap((s) => (s.sc ? [s.sc] : []))]);
  return {
    men: d.men.filter((m) => !m.svc && m.sectionId).length,
    camps: campIds.length,
    extras: assignments.n + duties.n,
    svc: d.men.filter((m) => m.svc).length,
    grantsOut: grants.n,
    grantsIn: commanders.filter((c) => c.registered).length,
  };
}
