// The changeover's "Paste the Telegram list": the sections will probably be
// announced as a Telegram message, not an ORBAT (phases-plan §3). Pure.
//
// Headers ("PLATOON 1", "Section 2", "PLT 3 SEC 1") say where everyone below
// them goes; names are matched as registration matches them (matchName). A
// rank, numbering, bullets, mixed case and a surname alone are all fine; a
// "(SC)" after a name drafts him as that section's SC. Lines before the
// first section header, and lines that aren't names, are ignored.

import { matchName, type Candidate } from "./registration";
import { RANKS } from "./roles";

export interface PastedName {
  /** 1-based line in the message */
  line: number;
  /** the line as pasted, trimmed */
  raw: string;
  rank: string | null;
  /** what's matched against the roster: upper case, no rank */
  name: string;
  platoon: string;
  section: string;
  sc: boolean;
}

export interface PastedList {
  names: PastedName[];
  /** platoon → its sections, in the order they appear */
  structure: { platoon: string; sections: string[] }[];
  /** name-like lines with no section above them */
  homeless: string[];
}

const MARKUP = /[*_~`|]/g;
const BULLET = /^(?:\d{1,3}\s*[.)\]:-]|\d{1,3}(?=\s)|[-•●▪◦·*+>]|\(\d{1,3}\))\s*/;
// "PLATOON 1", "PLT1", "Platoon A"; never "PLUTO" or "SECRET"
const PLATOON = /^(?:(?:PLATOON|PLT|PL)\.?\s*(\d{1,2})|PLATOON\s+([A-Z]))\b\s*[:.-]?\s*/i;
const SECTION = /^(?:(?:SECTION|SECT|SEC)\.?\s*(\d{1,2})|SECTION\s+([A-Z]))\b\s*[:.-]?\s*/i;
const RANK_RE = new RegExp(String.raw`^(${RANKS.join("|")})\.?\s+`, "i");
const NAME_ONLY = /^[A-Z][A-Z' .\-/@]*$/;
/** "12 pax", "Total: 18", "NIL": counts and notes, not men */
const NOT_A_NAME = /\b(PAX|TOTAL|NIL|TBC|TBA|STRENGTH|REMARKS?)\b/;

/** "PLATOON 1", "Section 2" → the canonical header words. */
const platoonName = (n: string) => `PLATOON ${n.toUpperCase()}`;
const sectionName = (n: string) => `SECTION ${n.toUpperCase()}`;

function clean(line: string): string {
  return line.replace(MARKUP, "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, "").trim();
}

/** A header on its own line ("PLATOON 1", "SECTION 2", "PLT 3 SEC 1"), or null. */
function header(line: string): { platoon?: string; section?: string } | null {
  let rest = line;
  const out: { platoon?: string; section?: string } = {};
  const p = PLATOON.exec(rest);
  if (p) {
    out.platoon = platoonName(p[1] ?? p[2]);
    rest = rest.slice(p[0].length);
  }
  const s = SECTION.exec(rest);
  if (s) {
    out.section = sectionName(s[1] ?? s[2]);
    rest = rest.slice(s[0].length);
  }
  if (!out.platoon && !out.section) return null;
  // "Section 1 (SC: 3SG TAN)" or "Platoon 1 – 18 pax" are still headers; a name after "PLATOON 1:" isn't read
  return rest.replace(/\(.*\)/g, "").trim().split(/\s+/).filter(Boolean).length <= 3 ? out : null;
}

/** A name line → rank, name and whether he's marked SC; null if it isn't a name. */
function nameOf(line: string): { rank: string | null; name: string; sc: boolean } | null {
  let rest = line.replace(BULLET, "").trim();
  let sc = false;
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (/^\s*(SC|SECTION COMMANDER|SEC COMD|IC)\s*$/i.test(inner)) sc = true;
    return " ";
  });
  rest = rest.replace(/\s+-\s*SC\s*$/i, () => ((sc = true), "")).trim();
  const r = RANK_RE.exec(rest);
  const rank = r ? r[1].toUpperCase() : null;
  if (r) rest = rest.slice(r[0].length);
  const name = rest.toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  if (!name || name.length < 2 || !NAME_ONLY.test(name) || NOT_A_NAME.test(name) || name.split(" ").length > 6) return null;
  return { rank, name, sc };
}

export function parsePastedList(text: string): PastedList {
  const names: PastedName[] = [];
  const structure: PastedList["structure"] = [];
  const homeless: string[] = [];
  let platoon: string | null = null;
  let section: string | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = clean(rawLine);
    if (!line) return;
    const h = header(line);
    if (h) {
      if (h.platoon) {
        platoon = h.platoon;
        section = null;
        if (!structure.some((x) => x.platoon === platoon)) structure.push({ platoon, sections: [] });
      }
      if (h.section) {
        // a section before any platoon header has nowhere to go
        if (!platoon) return;
        section = h.section;
        const entry = structure.find((x) => x.platoon === platoon)!;
        if (!entry.sections.includes(section)) entry.sections.push(section);
      }
      return;
    }
    const n = nameOf(line);
    if (!n) return;
    if (!platoon || !section) {
      if (platoon) homeless.push(line);
      return;
    }
    names.push({ line: i + 1, raw: line, ...n, platoon, section });
  });
  return { names, structure, homeless };
}

// ------------------------------------------------------------------ matching

/** A man the list can name: an active roster person outside COY HQ. */
export interface PoolPerson extends Candidate {
  rank: string;
  campName: string;
  /** an SVC trooper leaves at the changeover; COY HQ stays where it is */
  skip: "svc" | "hq" | null;
}

export type PasteVerdict<P extends PoolPerson> =
  | { kind: "matched"; person: P }
  | { kind: "unsure"; people: P[]; tooMany?: number }
  | { kind: "missing" }
  | { kind: "skip"; person: P; why: "svc" | "hq" | "twice" };

export interface PasteRow<P extends PoolPerson> {
  name: PastedName;
  verdict: PasteVerdict<P>;
}

/**
 * Each pasted name against the roster. A rank that agrees narrows a
 * "pick" (two men called LEE, one a CPL); a rank that agrees with none of
 * them makes it "not sure" among every man whose name contains it (ranks in
 * a message go stale). A combat trooper is preferred to an SVC or COY HQ
 * namesake. A man named twice keeps his first place; SVC troopers and COY HQ
 * aren't placed.
 */
export function matchPasted<P extends PoolPerson>(list: PastedList, pool: readonly P[]): PasteRow<P>[] {
  const seen = new Set<string>();
  return list.names.map((name): PasteRow<P> => {
    const m = matchName(name.name, pool);
    let verdict: PasteVerdict<P>;
    if (m.kind === "none") verdict = { kind: "missing" };
    else if (m.kind === "too-many") verdict = { kind: "unsure", people: [], tooMany: m.count };
    else {
      const hits = m.kind === "one" ? [m.person] : m.people;
      // the list is ROT's, so a combat trooper beats an SVC or COY HQ namesake
      const live = hits.filter((p) => !p.skip);
      const people = live.length ? live : hits.slice(0, 1);
      const ranked = name.rank ? people.filter((p) => p.rank.toUpperCase() === name.rank) : people;
      if (!ranked.length) verdict = { kind: "unsure", people: pool.filter((p) => !p.skip && p.name.toUpperCase().includes(name.name)) };
      else if (ranked.length === 1) verdict = { kind: "matched", person: ranked[0] };
      else verdict = { kind: "unsure", people: ranked };
    }
    if (verdict.kind === "matched") {
      const p = verdict.person;
      if (p.skip) verdict = { kind: "skip", person: p, why: p.skip };
      else if (seen.has(p.personId)) verdict = { kind: "skip", person: p, why: "twice" };
      else seen.add(p.personId);
    }
    return { name, verdict };
  });
}
