// Works out what a Sheets import would do to the roster if people were updated
// in place instead of wiped and recreated. Pure: no DB, so the dry run and the
// (later) in-place import share one answer, and it can be tested exactly.
//
// Matching, in order:
//   1. same camp, same name (case and spacing ignored) → kept
//   2. same name in another camp, exactly one on each side → moved
//   3. a name more than one person has → ambiguous: never matched by guesswork
//   4. the rest → added (only in the Sheet) or removed (only in the app)
// A removed person is to be marked inactive, never deleted, so whatever hangs
// off them (whereabouts records, Telegram links, history) survives.

import type { CoyInput } from "@/lib/data/write-coy";

export interface RosterRow {
  id: string;
  campName: string;
  name: string;
  rank: string;
  role: string;
}

export interface SheetRow {
  campName: string;
  name: string;
  rank: string;
  role: string;
}

export interface FieldChange {
  field: "rank" | "role" | "name";
  from: string;
  to: string;
}

export interface Matched {
  current: RosterRow;
  sheet: SheetRow;
  /** rank/role edits; name only when it differs in case or spacing */
  changes: FieldChange[];
}

export interface RosterPlan {
  kept: Matched[];
  moved: Matched[];
  added: SheetRow[];
  removed: RosterRow[];
  /** names that more than one person has, on either side, and couldn't be matched across camps */
  ambiguous: { name: string; current: RosterRow[]; sheet: SheetRow[] }[];
  /** a removed and an added name in the same camp that look like one person renamed */
  renameHints: { current: RosterRow; sheet: SheetRow }[];
  /** camps in the app that the Sheet no longer has */
  campsGone: string[];
}

export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

export const sheetCamps = (input: CoyInput) => input.subunits.flatMap((s) => s.camps.map((c) => c.name));

export function sheetRows(input: CoyInput): SheetRow[] {
  return input.subunits.flatMap((s) =>
    s.camps.flatMap((c) => c.people.map((p) => ({ campName: c.name, name: p.name, rank: p.rank, role: p.role }))),
  );
}

function changesBetween(current: RosterRow, sheet: SheetRow): FieldChange[] {
  const out: FieldChange[] = [];
  if (current.name !== sheet.name) out.push({ field: "name", from: current.name, to: sheet.name });
  if (current.rank !== sheet.rank) out.push({ field: "rank", from: current.rank, to: sheet.rank });
  if (current.role !== sheet.role) out.push({ field: "role", from: current.role, to: sheet.role });
  return out;
}

/** Levenshtein distance, stopping early once it's past `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

function looksRenamed(a: string, b: string) {
  const x = normName(a);
  const y = normName(b);
  if (x.replace(/ /g, "") === y.replace(/ /g, "")) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  return editDistance(x, y) <= 2;
}

export function planRoster(
  current: RosterRow[],
  sheet: SheetRow[],
  camps: { current: string[]; sheet: string[] } = { current: [], sheet: [] },
): RosterPlan {
  const plan: RosterPlan = { kept: [], moved: [], added: [], removed: [], ambiguous: [], renameHints: [], campsGone: [] };
  const key = (camp: string, name: string) => `${camp}\u0000${normName(name)}`;

  // 1. same camp, same name — only when the name is unique in that camp on both sides
  const curByKey = new Map<string, RosterRow[]>();
  for (const r of current) curByKey.set(key(r.campName, r.name), [...(curByKey.get(key(r.campName, r.name)) ?? []), r]);
  const sheetByKey = new Map<string, SheetRow[]>();
  for (const s of sheet) sheetByKey.set(key(s.campName, s.name), [...(sheetByKey.get(key(s.campName, s.name)) ?? []), s]);

  const curLeft = new Set(current);
  const sheetLeft = new Set(sheet);
  for (const [k, ss] of sheetByKey) {
    const cs = curByKey.get(k) ?? [];
    if (cs.length === 1 && ss.length === 1) {
      plan.kept.push({ current: cs[0], sheet: ss[0], changes: changesBetween(cs[0], ss[0]) });
      curLeft.delete(cs[0]);
      sheetLeft.delete(ss[0]);
    }
  }

  // 2. same name elsewhere in the coy; 3. ambiguous when more than one either side
  const curByName = new Map<string, RosterRow[]>();
  for (const r of curLeft) curByName.set(normName(r.name), [...(curByName.get(normName(r.name)) ?? []), r]);
  const sheetByName = new Map<string, SheetRow[]>();
  for (const s of sheetLeft) sheetByName.set(normName(s.name), [...(sheetByName.get(normName(s.name)) ?? []), s]);

  for (const name of new Set([...curByName.keys(), ...sheetByName.keys()])) {
    const cs = curByName.get(name) ?? [];
    const ss = sheetByName.get(name) ?? [];
    if (cs.length === 1 && ss.length === 1) {
      plan.moved.push({ current: cs[0], sheet: ss[0], changes: changesBetween(cs[0], ss[0]) });
    } else if (cs.length > 1 || ss.length > 1) {
      plan.ambiguous.push({ name, current: cs, sheet: ss });
    } else {
      plan.removed.push(...cs);
      plan.added.push(...ss);
    }
  }

  // hints only; the import still treats these as one removed and one added
  const addedLeft = new Set(plan.added);
  for (const r of plan.removed) {
    const hit = [...addedLeft].find((s) => s.campName === r.campName && looksRenamed(r.name, s.name));
    if (hit) {
      plan.renameHints.push({ current: r, sheet: hit });
      addedLeft.delete(hit);
    }
  }

  const sheetCamps = new Set(camps.sheet);
  plan.campsGone = camps.current.filter((c) => !sheetCamps.has(c));
  return plan;
}

/** What hangs off a person, so a removal can be weighed before it runs. */
export interface StakeCounts {
  /** linked to a Telegram account in the Mini App */
  members: number;
  records: number;
  assignments: number;
  absences: number;
}

function stakeText(s: StakeCounts | undefined) {
  if (!s) return "";
  const parts = [
    s.members && "Telegram linked",
    s.records && `${s.records} whereabouts record${s.records === 1 ? "" : "s"}`,
    s.assignments && `${s.assignments} assignment${s.assignments === 1 ? "" : "s"}`,
    s.absences && `${s.absences} v1 absence${s.absences === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? `  [${parts.join(" · ")}]` : "";
}

const who = (r: { campName: string; rank: string; name: string }) => `${r.campName} › ${r.rank} ${r.name}`.trim();

/** The dry run's report: what an in-place import would do, worst news last so it's what's on screen. */
export function formatRosterPlan(plan: RosterPlan, stakes: Map<string, StakeCounts>, label: string): string {
  const hinted = new Set<RosterRow | SheetRow>(plan.renameHints.flatMap((h) => [h.current, h.sheet]));
  const added = plan.added.filter((s) => !hinted.has(s));
  const removed = plan.removed.filter((r) => !hinted.has(r));
  const edited = plan.kept.filter((m) => m.changes.length);
  const sheetCount = plan.kept.length + plan.moved.length + plan.added.length + plan.ambiguous.reduce((n, a) => n + a.sheet.length, 0);
  const appCount = plan.kept.length + plan.moved.length + plan.removed.length + plan.ambiguous.reduce((n, a) => n + a.current.length, 0);
  const change = (c: FieldChange) => `${c.field} ${c.from || "(none)"} → ${c.to || "(none)"}`;

  const out: string[] = [
    `DRY RUN: nothing was written. ${label}: ${sheetCount} in the Sheet, ${appCount} in the app.`,
    "",
    [
      `✅ ${plan.kept.length - edited.length} unchanged`,
      `✏️ ${edited.length} edited`,
      `🔀 ${plan.moved.length} moved`,
      `➕ ${added.length} added`,
      `➖ ${removed.length} removed`,
      plan.renameHints.length && `❓ ${plan.renameHints.length} renamed?`,
      plan.ambiguous.length && `⚠️ ${plan.ambiguous.length} ambiguous`,
    ]
      .filter(Boolean)
      .join(" · "),
  ];
  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push("", title, ...lines.map((l) => `  ${l}`));
  };
  section("✏️ Edited (same camp, same person)", edited.map((m) => `${who(m.current)}: ${m.changes.map(change).join(", ")}`));
  section(
    "🔀 Moved camp (same person, history kept)",
    plan.moved.map((m) =>
      [`${m.current.rank} ${m.current.name}: ${m.current.campName} → ${m.sheet.campName}`, ...m.changes.map(change)].join(", "),
    ),
  );
  section("➕ Added (new people)", added.map(who));
  section(
    "➖ Removed: marked inactive, never deleted; off the parade state",
    removed.map((r) => who(r) + stakeText(stakes.get(r.id))),
  );
  section(
    "❓ Renamed? Counted as one removed + one added, so the man loses his history. If it's the same man, make the names match",
    plan.renameHints.map((h) => `${who(h.current)} → ${h.sheet.name}${stakeText(stakes.get(h.current.id))}`),
  );
  section(
    "⚠️ Ambiguous: more than one person has the name, so they can't be matched. The import will refuse to run until they're told apart",
    plan.ambiguous.map(
      (a) =>
        `${a.name}: app ${a.current.map((r) => r.campName).join(", ") || "(none)"} · Sheet ${a.sheet.map((s) => s.campName).join(", ") || "(none)"}`,
    ),
  );
  section("🏚 Camps the Sheet no longer has", plan.campsGone);
  return out.join("\n");
}
