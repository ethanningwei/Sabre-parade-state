// The projection plan in words: the admin's evening "🔍 Shadow diff" (projection
// off: what it would write) or "🔁 Projection" (on: what it wrote), and the
// same on demand (`npm run wb:setup -- diff`). Pure: names come in as maps.

import { toSgt } from "@/lib/parade/time";
import type { AbsenceValues, DutyValues, Note, Plan, Write } from "./projection";
import { dayMonth } from "./timeline";

export interface Who {
  rank: string;
  name: string;
  campId: string;
}

export interface ReportInput {
  plan: Plan;
  /**
   * shadow   projection off: what it would write, nothing written
   * applied  on: what a sync just wrote
   * pending  on: what the next sync will write (read-only look)
   */
  mode: "shadow" | "applied" | "pending";
  people: ReadonlyMap<string, Who>;
  /** campId -> name, in roster order */
  camps: ReadonlyMap<string, string>;
  applied?: number;
  failed?: readonly { write: Write; error: string }[];
}

/** Telegram's limit is 4096; leave room for the tail line. */
const MAX = 3900;

const when = (date: string | null, time: string | null) => (date ? `${dayMonth(date)}${time ? ` ${time}` : ""}` : "");
const span = (s: string, e: string) => (e ? `${s}–${e}` : s);

export function absenceText(v: AbsenceValues): string {
  if (v.status === "MA") return `MA ${when(v.startDate, null)} ${v.maTiming}H${v.maLocation ? ` @ ${v.maLocation}` : ""}`;
  const what = v.status === "OTHERS" ? v.otherReason : v.status;
  return `${what} ${span(when(v.startDate, v.startTime), when(v.endDate, v.endTime))}`.trim();
}

function dutyText(v: DutyValues, camps: ReadonlyMap<string, string>): string {
  return `${v.type} @ ${camps.get(v.campId) ?? "?"} ${span(when(v.startDate, v.startTime), when(v.endDate, v.endTime))}`;
}

const WHY: Record<string, string> = {
  VOID: "its record was cancelled or moved",
  BACK: "Back confirmed",
  STOOD_DOWN: "stood down",
};

function writeLine(w: Exclude<Write, { op: "shift" }>, camps: ReadonlyMap<string, string>): string {
  switch (w.op) {
    case "absence":
      return `${w.why === "open" ? "+" : "~"} ${absenceText(w.values)}${w.why === "switch" ? " (replaces the last one)" : ""}`;
    case "close-absence":
      return `− back, present (${WHY[w.why]})`;
    case "duty":
      return `${w.why === "open" ? "+" : "~"} ${dutyText(w.values, camps)}`;
    case "end-duty":
      return `− duty ended (${WHY[w.why]})`;
  }
}

function noteLine(n: Note): string | null {
  switch (n.op) {
    case "conflict":
      return `⚠️ the GC has ${n.has}, the timeline says ${n.want}: left as the GC has it`;
    case "waiting":
      return `⏸ waits: ${n.reason}`;
    case "due-back":
      return `⌛ ${n.what} ended ${when(toSgt(n.endedAt).date, toSgt(n.endedAt).time)}, waiting for Back`;
    case "closed-by-hand":
      return `✋ a GC closed or changed it by hand: left alone`;
    case "agrees":
      return null;
  }
}

export function formatProjection(r: ReportInput): string {
  const { plan, people, camps } = r;
  const failedOf = new Map((r.failed ?? []).map((f) => [f.write, f.error]));
  const byCamp = new Map<string, string[]>();
  const add = (personId: string, line: string) => {
    const who = people.get(personId);
    const campId = who?.campId ?? "";
    byCamp.set(campId, [...(byCamp.get(campId) ?? []), `${who ? `${who.rank} ${who.name}` : "Someone no longer on the roster"}: ${line}`]);
  };
  for (const w of plan.writes) {
    if (w.op === "shift") continue;
    const err = failedOf.get(w);
    add(w.personId, writeLine(w, camps) + (err ? ` ✖ not written: ${err}` : ""));
  }
  for (const n of plan.notes) {
    const line = noteLine(n);
    if (line) add(n.personId, line);
  }
  const shifts = plan.writes.filter((w): w is Extract<Write, { op: "shift" }> => w.op === "shift");
  const agrees = plan.notes.filter((n) => n.op === "agrees").length;

  const head =
    r.mode === "applied"
      ? `🔁 Projection\n\nWritten to the parade state: ${r.applied ?? 0}${r.failed?.length ? ` · not written: ${r.failed.length}` : ""}`
      : r.mode === "pending"
        ? "🔍 Projection is on\n\nThis is what the next sync writes to the parade state (any page load or whereabouts write)."
        : "🔍 Shadow diff\n\nProjection is off: this is what it would write to the parade state now. Nothing was written.";
  const parts: string[] = [head];
  if (!byCamp.size && !shifts.length) {
    parts.push("Nothing to change: the parade state already agrees with the timeline.");
  }
  for (const [campId, name] of [...camps, ["", "Not on the roster"] as const]) {
    const lines = byCamp.get(campId);
    if (lines) parts.push([name, ...lines.map((l) => `• ${l}`)].join("\n"));
  }
  if (shifts.length) parts.push(`Shifts (HOTO): ${shifts.map((s) => `${camps.get(s.campId) ?? "?"} ${s.onShift ? "on" : "off"}`).join(", ")}`);
  if (agrees) parts.push(`${agrees} already as the GCs typed them.`);

  let text = parts.join("\n\n");
  if (text.length > MAX) {
    const cut = text.lastIndexOf("\n", MAX);
    const left = text.slice(cut).split("\n").filter((l) => l.startsWith("• ")).length;
    text = `${text.slice(0, cut)}\n… and ${left} more (npm run wb:setup -- diff)`;
  }
  return text;
}
