import { describe, expect, it } from "vitest";
import { sgtToInstant } from "@/lib/parade/time";
import {
  gaps,
  hotoEffect,
  minimumLabel,
  nextFlipAt,
  onDay,
  onDuring,
  onShiftAt,
  overrideLabel,
  overrideWindow,
  pairProblem,
  parseMinimum,
  partnerPattern,
  stintAround,
  strengthLabel,
  strengthOf,
  WEEKDAYS,
  weeklyWant,
  type ShiftPattern,
} from "@/lib/wb/domain/shifts";
import { addDays, dayRange } from "@/lib/wb/domain/timeline";

const at = (date: string, time = "1200") => sgtToInstant({ date, time });

const cycle = (campId: string, anchorDate: string, on = 3, off = 3, extra: Partial<ShiftPattern> = {}): ShiftPattern => ({
  campId,
  kind: "CYCLE",
  onDays: on,
  offDays: off,
  anchorDate,
  hotoTime: "2100",
  weekdayMask: 0,
  holidaysOff: false,
  bothOnAllowed: false,
  ...extra,
});
const weekly = (campId: string, holidaysOff = true): ShiftPattern => ({ ...cycle(campId, "2026-01-01"), kind: "WEEKLY", anchorDate: null, weekdayMask: WEEKDAYS, holidaysOff });
const always = (campId: string): ShiftPattern => ({ ...cycle(campId, "2026-01-01"), kind: "ALWAYS", anchorDate: null });

// The real SFT cycle from the Sabre Coy calendar: Team B mounted 10/10 2100.
const sftB = cycle("SFT B", "2026-10-10");
const sftA = partnerPattern(sftB, "SFT A");

describe("CYCLE", () => {
  it("flips at the HOTO time, 3 in 3 out", () => {
    expect(onShiftAt(sftB, at("2026-10-10", "2059"))).toBe(false);
    expect(onShiftAt(sftB, at("2026-10-10", "2100"))).toBe(true);
    expect(onShiftAt(sftB, at("2026-10-13", "2059"))).toBe(true);
    expect(onShiftAt(sftB, at("2026-10-13", "2100"))).toBe(false);
    expect(onShiftAt(sftA, at("2026-10-13", "2100"))).toBe(true);
    expect(onShiftAt(sftA, at("2026-10-16", "2100"))).toBe(false);
  });

  it("holds across many cycles, both ways from the anchor", () => {
    // the calendar: B mounted 28/09 2100 and mounts again 22/10, 28/10 …
    for (const d of ["2026-09-28", "2026-10-04", "2026-10-22", "2026-10-28", "2027-03-11"]) {
      expect(onShiftAt(sftB, at(d, "2130")), d).toBe(true);
      expect(onShiftAt(sftA, at(d, "2130")), d).toBe(false);
    }
    // 600 days on, the arithmetic hasn't drifted (SGT has no DST)
    const far = addDays("2026-10-10", 600);
    expect(onShiftAt(sftB, at(far, "2100"))).toBe(true);
  });

  it("is on for all four days a stint touches", () => {
    expect(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((d) => onDay(sftB, d))).toEqual([true, true, true, true]);
    expect(onDay(sftB, "2026-10-14")).toBe(false);
    expect(onDay(sftB, "2026-10-16")).toBe(true);
    // both teams stand on the handover day
    expect(onDay(sftA, "2026-10-13")).toBe(true);
  });

  it("onDuring sees a stint starting inside a long range", () => {
    expect(onDuring(sftA, { startAt: at("2026-10-14", "0000"), endAt: at("2026-10-16", "2101") })).toBe(true);
    expect(onDuring(sftB, { startAt: at("2026-10-14", "0000"), endAt: at("2026-10-16", "2100") })).toBe(false);
  });

  it("says nothing without an anchor", () => {
    expect(onShiftAt({ ...sftB, anchorDate: null }, at("2026-10-11"))).toBeNull();
    expect(onDuring({ ...sftB, anchorDate: null }, dayRange("2026-10-11"))).toBeNull();
  });

  it("stintAround gives the current or next stint", () => {
    expect(stintAround(sftB, at("2026-10-12"))).toEqual({ startAt: at("2026-10-10", "2100"), endAt: at("2026-10-13", "2100") });
    expect(stintAround(sftB, at("2026-10-14"))).toEqual({ startAt: at("2026-10-16", "2100"), endAt: at("2026-10-19", "2100") });
  });
});

describe("pairs", () => {
  it("never leaves a pair empty or doubled", () => {
    for (let h = 0; h < 24 * 30; h++) {
      const t = new Date(at("2026-10-01", "0000").getTime() + h * 3_600_000);
      expect(Number(onShiftAt(sftA, t)) + Number(onShiftAt(sftB, t))).toBe(1);
    }
    expect(pairProblem(sftA, sftB, ["SFT A", "SFT B"])).toBeNull();
  });

  it("finds a pair whose anchors leave a gap or an overlap", () => {
    // moving one side of a 3-in-3-out leaves a gap on one side and an overlap on the other
    expect(pairProblem(sftB, { ...sftA, anchorDate: "2026-10-14" }, ["SFT B", "SFT A"])).toMatch(/SFT B and SFT A would both be on|Nobody would be on at SFT/);
    expect(pairProblem(sftB, { ...sftA, onDays: 2, offDays: 4 }, ["SFT B", "SFT A"])).toMatch(/^Nobody would be on at SFT on /);
    expect(pairProblem(sftB, { ...sftA, onDays: 4, offDays: 2 }, ["SFT B", "SFT A"])).toMatch(/both be on/);
  });

  it("SRF: weekly, both stand on the changeover Monday, never both off", () => {
    const srfB = cycle("SRF B", "2026-10-12", 7, 7, { bothOnAllowed: true });
    const srfA = partnerPattern(srfB, "SRF A");
    expect(srfA.anchorDate).toBe("2026-10-19");
    expect(onDay(srfB, "2026-10-19") && onDay(srfA, "2026-10-19")).toBe(true);
    expect(onDay(srfA, "2026-10-20")).toBe(true);
    expect(onDay(srfB, "2026-10-20")).toBe(false);
    expect(onDay(srfB, "2026-10-26") && onDay(srfA, "2026-10-26")).toBe(true);
    expect(pairProblem(srfA, srfB, ["SRF A", "SRF B"])).toBeNull();
    // both-on allowed tolerates an overlap, but still not a gap
    expect(pairProblem(srfB, { ...srfA, onDays: 8, offDays: 6 }, ["SRF B", "SRF A"])).toBeNull();
    expect(pairProblem(srfB, { ...srfA, anchorDate: "2026-10-20" }, ["SRF B", "SRF A"])).toMatch(/Nobody/);
  });
});

describe("weekday camps: the projector's switch and an admin's override (2026-10-14)", () => {
  const slr = weekly("SLR");
  const midnight = (date: string) => dayRange(date).startAt;

  it("flips at SGT midnight: off on Saturday, on again on Monday, or after a public holiday", () => {
    expect(nextFlipAt(slr, at("2026-10-14"))).toEqual(midnight("2026-10-17"));
    expect(nextFlipAt(slr, at("2026-10-17"))).toEqual(midnight("2026-10-19"));
    // Deepavali in lieu, Monday 9/11: back on Tuesday
    expect(nextFlipAt(slr, at("2026-11-07"))).toEqual(midnight("2026-11-10"));
    expect(nextFlipAt(always("HQ"), at("2026-10-14"))).toBeNull();
  });

  it("an override covers the stretch where the pattern says otherwise: from now, or the next one", () => {
    // Saturday, keep it on: now until Monday
    expect(overrideWindow(slr, at("2026-10-17"), true)).toEqual({ startAt: at("2026-10-17"), endAt: midnight("2026-10-19") });
    // Friday, keep it on: the weekend
    expect(overrideWindow(slr, at("2026-10-16"), true)).toEqual({ startAt: midnight("2026-10-17"), endAt: midnight("2026-10-19") });
    // Wednesday, keep it off: now until the weekend (when it's off anyway)
    expect(overrideWindow(slr, at("2026-10-14"), false)).toEqual({ startAt: at("2026-10-14"), endAt: midnight("2026-10-17") });
    expect(overrideWindow(cycle("SFT B", "2026-10-10"), at("2026-10-14"), true)).toBeNull();
  });

  it("labels say how long", () => {
    const now = at("2026-10-16");
    expect(overrideLabel(overrideWindow(slr, now, true)!, true, now)).toBe("Keep on Sat 17/10–Sun 18/10");
    expect(overrideLabel(overrideWindow(slr, now, false)!, false, now)).toBe("Keep off until Sat 17/10");
    const sat = at("2026-10-17");
    expect(overrideLabel(overrideWindow(slr, sat, true)!, true, sat)).toBe("Keep on until Mon 19/10");
  });

  it("what a camp should be: an override in force wins, else the pattern", () => {
    const keepOn = [{ on: true, fromAt: midnight("2026-10-17"), untilAt: midnight("2026-10-19") }];
    expect(weeklyWant(slr, keepOn, at("2026-10-17"))).toBe(true);
    expect(weeklyWant(slr, keepOn, at("2026-10-16"))).toBe(true);
    expect(weeklyWant(slr, [], at("2026-10-18"))).toBe(false);
    expect(weeklyWant(slr, keepOn, at("2026-10-19"))).toBe(true);
  });
});

describe("WEEKLY and ALWAYS", () => {
  it("RG is Monday to Friday, in SGT", () => {
    const slr = weekly("SLR");
    // Fri 16/10, Sat 17/10, Sun 18/10, Mon 19/10
    expect(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].map((d) => onDay(slr, d))).toEqual([true, false, false, true]);
    // Saturday 00:30 SGT is still Friday 16:30 UTC: the weekday is SGT's
    expect(onShiftAt(slr, at("2026-10-17", "0030"))).toBe(false);
    expect(onShiftAt(slr, at("2026-10-16", "2359"))).toBe(true);
  });

  it("a public holiday is off when the pattern says so", () => {
    // Deepavali in lieu, Monday 9/11/2026
    expect(onDay(weekly("SLR"), "2026-11-09")).toBe(false);
    expect(onDay(weekly("SLR", false), "2026-11-09")).toBe(true);
    expect(onDay(weekly("SLR"), "2026-11-10")).toBe(true);
  });

  it("a range over a weekend still touches the Friday", () => {
    expect(onDuring(weekly("SLR"), { startAt: at("2026-10-16", "1800"), endAt: at("2026-10-19", "0000") })).toBe(true);
    expect(onDuring(weekly("SLR"), { startAt: at("2026-10-17", "0000"), endAt: at("2026-10-19", "0000") })).toBe(false);
  });

  it("ALWAYS is on", () => {
    expect(onShiftAt(always("X"), at("2026-10-17"))).toBe(true);
    expect(onDay(always("X"), "2026-11-09")).toBe(true);
  });
});

describe("HOTO", () => {
  it("on time (within six hours) confirms", () => {
    const e = hotoEffect(sftA, { on: true, at: at("2026-10-13", "2130") });
    expect(e).toEqual({ matched: true, expected: at("2026-10-13", "2100") });
    expect(hotoEffect(sftB, { on: false, at: at("2026-10-13", "1700") }).matched).toBe(true);
    expect(hotoEffect(sftA, { on: true, at: at("2026-10-14", "0300") }).matched).toBe(true);
  });

  it("a day late re-anchors so this team's stint starts at that HOTO", () => {
    const e = hotoEffect(sftA, { on: true, at: at("2026-10-14", "2115") });
    expect(e.matched).toBe(false);
    if (e.matched) return;
    expect(e.expected).toEqual(at("2026-10-13", "2100"));
    expect(e.anchorDate).toBe("2026-10-14");
    const moved = { ...sftA, anchorDate: e.anchorDate };
    expect(onShiftAt(moved, at("2026-10-14", "2101"))).toBe(true);
    expect(onShiftAt(moved, at("2026-10-17", "2101"))).toBe(false);
    // its partner follows
    expect(onShiftAt(partnerPattern(moved, "SFT B"), at("2026-10-17", "2101"))).toBe(true);
  });

  it("an early handover re-anchors so the stint ends there", () => {
    const e = hotoEffect(sftB, { on: false, at: at("2026-10-12", "2100") });
    expect(e.matched).toBe(false);
    if (e.matched) return;
    expect(e.anchorDate).toBe("2026-10-09");
    expect(onShiftAt({ ...sftB, anchorDate: e.anchorDate }, at("2026-10-12", "2101"))).toBe(false);
  });

  it("a HOTO with no anchor yet sets one", () => {
    const e = hotoEffect({ ...sftA, anchorDate: null }, { on: true, at: at("2026-10-13", "2047") });
    expect(e).toEqual({ matched: false, expected: null, anchorDate: "2026-10-13" });
    // logged just after midnight: the flip was the evening before
    expect(hotoEffect({ ...sftA, anchorDate: null }, { on: true, at: at("2026-10-14", "0030") })).toMatchObject({ anchorDate: "2026-10-13" });
  });
});

describe("minimum manning", () => {
  it("parses GC:ST CBT:ST SVC, a bare number, and refuses junk", () => {
    expect(parseMinimum("1:4:3")).toEqual({ total: 8, roles: { GC: 1, "ST CBT": 4, "ST SVC": 3 } });
    expect(parseMinimum(" 1 : 0 : 7 ")).toEqual({ total: 8, roles: { GC: 1, "ST CBT": 0, "ST SVC": 7 } });
    expect(parseMinimum("8")).toEqual({ total: 8, roles: null });
    for (const junk of ["", "  ", "1:4", "1:4:3:2", "a:b:c", "1.5", "-1", "1:-4:3", null, undefined]) expect(parseMinimum(junk)).toBeNull();
    expect(minimumLabel(parseMinimum("1:4:8")!)).toBe("1:4:8");
    expect(minimumLabel(parseMinimum("12")!)).toBe("12");
  });

  it("counts roles through the roster's aliases", () => {
    const s = strengthOf(["GUARD COMM", "CBT", "CBT", "SVC", "svc", "ST SVC"]);
    expect(s).toEqual({ present: 6, byRole: { GC: 1, "ST CBT": 2, "ST SVC": 3 }, unknown: 0 });
    expect(strengthLabel(s, parseMinimum("1:4:3"))).toBe("1:2:3");
  });

  it("gaps per role, or by total once a role is unknown", () => {
    const min = parseMinimum("1:4:3")!;
    expect(gaps(min, strengthOf(["CBT", "CBT", "CBT", "SVC", "SVC", "SVC", "SVC"]))).toEqual([
      { role: "GC", short: 1 },
      { role: "ST CBT", short: 1 },
    ]);
    expect(gaps(min, strengthOf(["GUARD COMM", "CBT", "CBT", "CBT", "CBT", "SVC", "SVC", "SVC"]))).toEqual([]);
    // one man with no role: 8 heads meet the total of 8, whatever their roles
    const unknown = strengthOf(["", "CBT", "CBT", "CBT", "CBT", "SVC", "SVC", "SVC"]);
    expect(gaps(min, unknown)).toEqual([]);
    expect(strengthLabel(unknown, min)).toBe("8");
    expect(gaps(min, strengthOf(["", "CBT"]))).toEqual([{ role: null, short: 6 }]);
    expect(gaps(parseMinimum("5")!, strengthOf(["CBT", "CBT"]))).toEqual([{ role: null, short: 3 }]);
  });
});
