import { describe, expect, it } from "vitest";
import { computeCoy } from "@/lib/parade/compute";
import { sgtToInstant } from "@/lib/parade/time";
import type { CoySnapshot } from "@/lib/parade/types";
import { forecastGrid, manningLine, manningOf, snapshotAt, snapshotFor, worstDay, type ForecastInput, type TimelineRow } from "@/lib/wb/domain/forecast";
import { parseMinimum, partnerPattern, WEEKDAYS, type ShiftPattern } from "@/lib/wb/domain/shifts";
import { dateRange, dayRange } from "@/lib/wb/domain/timeline";
import { exampleSnapshot } from "../fixtures/example-snapshot";

// The fixture is the real parade state of 30/09/26 1100H.
const NOW = sgtToInstant({ date: "2026-09-30", time: "1100" });

const base = (): CoySnapshot => exampleSnapshot();
const campId = (s: CoySnapshot, name: string) => s.subunits.flatMap((u) => u.camps).find((c) => c.name === name)!.id;
const campOf = (s: CoySnapshot, name: string) => s.subunits.flatMap((u) => u.camps).find((c) => c.name === name)!;
const personIn = (s: CoySnapshot, camp: string, name: string) => campOf(s, camp).people.find((p) => p.name === name)!.id;

const cycle = (campId: string, anchorDate: string, on = 3, off = 3, bothOnAllowed = false): ShiftPattern => ({
  campId,
  kind: "CYCLE",
  onDays: on,
  offDays: off,
  anchorDate,
  hotoTime: "2100",
  weekdayMask: 0,
  holidaysOff: false,
  bothOnAllowed,
});
const weekly = (campId: string): ShiftPattern => ({ ...cycle(campId, "2026-01-01"), kind: "WEEKLY", anchorDate: null, weekdayMask: WEEKDAYS, holidaysOff: true });
const always = (campId: string): ShiftPattern => ({ ...cycle(campId, "2026-01-01"), kind: "ALWAYS", anchorDate: null });

/** The calendar's patterns: B teams mounted 28/09 2100; single camps RG. SRF stands both teams in the fixture. */
function realPatterns(s: CoySnapshot): Map<string, ShiftPattern> {
  const m = new Map<string, ShiftPattern>();
  for (const post of ["SFT", "OSU", "PYAD"]) {
    const b = cycle(campId(s, `${post} B`), "2026-09-28");
    m.set(b.campId, b);
    m.set(campId(s, `${post} A`), partnerPattern(b, campId(s, `${post} A`)));
  }
  for (const c of ["SRF A", "SRF B"]) m.set(campId(s, c), always(campId(s, c)));
  for (const c of ["COY HQ", "TFT", "HDN", "SLR", "BDK", "PRC"]) m.set(campId(s, c), weekly(campId(s, c)));
  return m;
}

let seq = 0;
const row = (personId: string, kind: TimelineRow["kind"], start: string, end: string, state: TimelineRow["state"] = "APPROVED"): TimelineRow => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  personId,
  kind,
  state,
  ...dateRange(start, end),
  detail: "",
});

const input = (s: CoySnapshot, records: TimelineRow[] = [], patterns = realPatterns(s)): ForecastInput => ({ base: s, now: NOW, patterns, records });

describe("snapshotAt", () => {
  it("today's patterns put the same teams on shift as v1's toggles", () => {
    const s = base();
    const built = snapshotAt(input(s), NOW).snapshot;
    const on = (x: CoySnapshot) => x.subunits.flatMap((u) => u.camps.map((c) => [c.name, c.onShift]));
    expect(on(built)).toEqual(on(s));
  });

  it("never reads the parade state's own absences or Extra/RF/SOL, today or later", () => {
    const s = base();
    // the fixture is full of v1 absences (MCs, OL, undated OTHERS) and RF/Extra duties
    expect(s.subunits.some((u) => u.camps.some((c) => c.people.some((p) => p.absence)))).toBe(true);
    expect(s.duties.length).toBeGreaterThan(0);
    for (const t of [NOW, sgtToInstant({ date: "2026-10-05", time: "1200" })]) {
      const built = snapshotAt(input(s), t).snapshot;
      expect(built.subunits.every((u) => u.camps.every((c) => c.people.every((p) => p.absence === null)))).toBe(true);
      expect(built.duties).toEqual([]);
      const state = computeCoy(built);
      for (const c of state.subunits.flatMap((u) => u.camps)) expect(c.present).toBe(c.onShift ? c.total : 0);
    }
  });

  it("a camp with no pattern keeps its v1 shift", () => {
    const s = base();
    const built = snapshotFor(input(s, [], new Map()), dayRange("2026-10-02"));
    expect(campOf(built.snapshot, "SFT A").onShift).toBe(false);
    expect(campOf(built.snapshot, "SFT B").onShift).toBe(true);
  });

  it("a later day moves the shifts", () => {
    const s = base();
    const fri = snapshotFor(input(s), dayRange("2026-10-02")).snapshot;
    // A mounted 01/10 2100: on all of 02/10, B off
    expect(campOf(fri, "SFT A").onShift).toBe(true);
    expect(campOf(fri, "SFT B").onShift).toBe(false);
    // a Saturday: RG is off
    expect(campOf(snapshotFor(input(s), dayRange("2026-10-03")).snapshot, "SLR").onShift).toBe(false);
  });

  it("a future approved AL counts him out; pending only when asked", () => {
    const s = base();
    const p = personIn(s, "SLR", "SLR PRESENT 1");
    const al = row(p, "AL", "2026-10-05", "2026-10-06");
    const off = row(personIn(s, "SLR", "SLR PRESENT 2"), "OFF", "2026-10-05", "2026-10-05", "PENDING");
    const slr = (opts = {}) => manningOf(snapshotFor(input(s, [al, off]), dayRange("2026-10-05"), opts)).find((m) => m.campName === "SLR")!;
    const before = manningOf(snapshotFor(input(s, [al, off]), dayRange("2026-10-02"))).find((m) => m.campName === "SLR")!;
    expect(slr().strength.present).toBe(before.strength.present - 1);
    expect(slr().away.find((a) => a.personId === p)).toMatchObject({ what: "AL", recordId: al.id, pending: false });
    const withPending = slr({ pending: true });
    expect(withPending.strength.present).toBe(before.strength.present - 2);
    expect(withPending.away.find((a) => a.pending)?.personId).toBe(off.personId);
  });

  it("report sick and statuses never take anyone off; dead rows never count", () => {
    const s = base();
    const p = personIn(s, "SLR", "SLR PRESENT 1");
    const rows = [
      row(p, "RSO", "2026-10-05", "2026-10-05"),
      row(p, "STATUS", "2026-10-05", "2026-10-05", "RECORDED"),
      row(personIn(s, "SLR", "SLR PRESENT 2"), "AL", "2026-10-05", "2026-10-05", "REJECTED"),
      row(personIn(s, "SLR", "SLR PRESENT 3"), "AL", "2026-10-05", "2026-10-05", "WITHDRAWN"),
    ];
    const m = manningOf(snapshotFor(input(s, rows), dayRange("2026-10-05"), { pending: true })).find((x) => x.campName === "SLR")!;
    expect(m.away.map((a) => a.personId)).not.toContain(p);
    expect(m.away.some((a) => a.recordId)).toBe(false);
  });

  it("an event counts as OTHERS with its detail", () => {
    const s = base();
    const ev = { ...row(personIn(s, "SLR", "SLR PRESENT 1"), "EVENT", "2026-10-05", "2026-10-05", "RECORDED"), detail: "IPPT @ KRANJI" };
    const m = manningOf(snapshotFor(input(s, [ev]), dayRange("2026-10-05"))).find((x) => x.campName === "SLR")!;
    expect(m.away.find((a) => a.recordId === ev.id)?.what).toBe("OTHERS: IPPT @ KRANJI");
  });
});

/** The fixture with guardroom roles on SLR: 1 GC, 5 CBT, the rest SVC. */
function withRoles(): CoySnapshot {
  const s = base();
  const slr = campOf(s, "SLR");
  slr.people.forEach((p, i) => (p.role = i === 5 ? "GUARD COMM" : i >= 6 && i < 11 ? "CBT" : "SVC"));
  return s;
}

describe("the grid", () => {
  it("marks short days red, and days only pending requests would make short striped", () => {
    const s = withRoles();
    const slrId = campId(s, "SLR");
    const gc = campOf(s, "SLR").people[5].id;
    const cbt = campOf(s, "SLR").people[6].id;
    const records = [row(gc, "AL", "2026-10-06", "2026-10-06"), row(cbt, "OFF", "2026-10-07", "2026-10-07", "PENDING")];
    const [r] = forecastGrid(input(s, records), [slrId], ["2026-10-03", "2026-10-05", "2026-10-06", "2026-10-07"], new Map([[slrId, parseMinimum("1:5:3")!]]));
    expect(r.campName).toBe("SLR");
    const [sat, mon, tue, wed] = r.cells;
    expect(sat).toMatchObject({ on: false, short: false, pendingShort: false });
    expect(mon).toMatchObject({ on: true, short: false, pendingShort: false, pendingLabel: null });
    expect(tue).toMatchObject({ on: true, short: true });
    expect(tue.label).toMatch(/^0:/);
    expect(wed).toMatchObject({ on: true, short: false, pendingShort: true });
    expect(wed.pendingLabel).toMatch(/^1:4:/);
  });

  it("only the camps asked for, in that order", () => {
    const s = base();
    const ids = [campId(s, "PRC"), campId(s, "SLR")];
    expect(forecastGrid(input(s), ids, ["2026-10-05"], new Map()).map((r) => r.campName)).toEqual(["PRC", "SLR"]);
  });
});

describe("worst day and the card line", () => {
  const min = parseMinimum("1:5:3")!;

  it("counts the requester out and finds the worst day of the range", () => {
    const s = withRoles();
    const slr = campOf(s, "SLR");
    const req = { ...row(slr.people[6].id, "AL", "2026-10-05", "2026-10-07", "PENDING"), campId: slr.id };
    const gcAway = row(slr.people[5].id, "OFF", "2026-10-06", "2026-10-06");
    const w = worstDay(input(s, [req, gcAway]), req, min)!;
    expect(w.date).toBe("2026-10-06");
    expect(w.multiDay).toBe(true);
    expect(w.verdict.label).toBe("0:4:11");
    expect(manningLine({ name: "SLR", isHq: false }, w, { minimum: min })).toBe("SLR on 06/10 (worst day): 0:4:11 / min 1:5:3 — BELOW MINIMUM");
  });

  it("notes what other pending requests would do", () => {
    const s = withRoles();
    const slr = campOf(s, "SLR");
    const req = { ...row(slr.people[12].id, "OFF", "2026-10-05", "2026-10-05", "PENDING"), campId: slr.id };
    const other = row(slr.people[6].id, "OFF", "2026-10-05", "2026-10-05", "PENDING");
    const w = worstDay(input(s, [req, other]), req, min)!;
    expect(w.pendingCount).toBe(1);
    expect(manningLine({ name: "SLR", isHq: false }, w, { minimum: min })).toBe("SLR on 05/10: 1:5:10 / min 1:5:3 (+1 pending would make it 1:4:10)");
  });

  it("skips days the camp is off, and says so when it's off throughout", () => {
    const s = base();
    const sftA = campOf(s, "SFT A");
    // SFT A: on 01/10 2100–04/10 2100, off until 07/10 2100
    const req = { ...row(sftA.people[0].id, "OFF", "2026-10-05", "2026-10-06", "PENDING"), campId: sftA.id };
    expect(worstDay(input(s, [req]), req, parseMinimum("20"))).toBeNull();
    expect(manningLine({ name: "SFT A", isHq: false }, null, { minimum: parseMinimum("20") })).toBe("SFT A is off shift for all of it");
    const longer = { ...req, ...dateRange("2026-10-05", "2026-10-08") };
    expect(worstDay(input(s, [longer]), longer, parseMinimum("20"))?.date).toBe("2026-10-07");
  });

  it("an RSO says what an MC would do; HQ and unset minimums", () => {
    const s = withRoles();
    const slr = campOf(s, "SLR");
    const rso = { ...row(slr.people[5].id, "RSO", "2026-10-05", "2026-10-05", "PENDING"), campId: slr.id };
    const w = worstDay(input(s, [rso]), rso, min)!;
    expect(w.verdict.label).toBe("0:5:11");
    expect(manningLine({ name: "SLR", isHq: false }, w, { minimum: min, ifMc: true })).toBe("SLR on 05/10 if he's given an MC: 0:5:11 / min 1:5:3 — BELOW MINIMUM");
    expect(manningLine({ name: "SLR", isHq: false }, w, { minimum: null })).toBe("No minimum manning set for SLR");
    expect(manningLine({ name: "COY HQ", isHq: true }, w, { minimum: min })).toBe("");
  });
});
