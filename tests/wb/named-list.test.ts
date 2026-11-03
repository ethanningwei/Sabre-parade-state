import { describe, expect, it } from "vitest";
import { conductInput } from "@/lib/wb/domain/conducts";
import { byRole, dueLabel, namedAskText, namedListText, namedPreTicked, plt, teamFor, teamOf, type SetUpCamp } from "@/lib/wb/domain/named-list";
import { needsYou } from "@/lib/wb/domain/needs-you";
import type { ShiftPattern } from "@/lib/wb/domain/shifts";
import { v1CoversDay } from "@/lib/wb/domain/strength-list";
import type { SnapshotAbsence } from "@/lib/parade/types";

// Named lists, the pure parts (slice 3 of docs/conducts-plan.md): the coy
// list word for word (modelled on the chat's 120826 OSE list), which camps
// and team start ticked, the set-up form's due day, a parade-state entry
// touching a day, and Needs you's line.

const man = (rank: string, name: string) => ({ rank, name });

describe("namedListText", () => {
  const platoons = [
    {
      name: "PLATOON 5",
      camps: [
        { name: "HDN", sent: true, men: [man("LCP", "CASEY ")] },
        { name: "SFT A", sent: true, men: [man("3SG", "ILYAS"), man("LCP", "PARTHIV")] },
        { name: "TFT", sent: true, men: [] },
      ],
    },
    { name: "PLATOON 6", camps: [{ name: "SLR", sent: false, men: [] }] },
  ];

  it("the chat's template, with Sabre's counts, NIL for nobody and a blank heading while waiting", () => {
    expect(namedListText({ date: "2026-08-12", title: "ose & comd training", team: "A", platoons })).toBe(
      [
        "120826 OSE & COMD TRAINING",
        "(Team A)",
        "",
        "Participants",
        "",
        "Total Strength: 3",
        "",
        "Plt 5: 3",
        "",
        "HDN:",
        "LCP CASEY",
        "",
        "SFT A:",
        "3SG ILYAS",
        "LCP PARTHIV",
        "",
        "TFT:",
        "NIL",
        "",
        "Plt 6:",
        "",
        "SLR:",
      ].join("\n"),
    );
  });

  it("no team line without a team, and no counts before anyone has sent", () => {
    const text = namedListText({ date: "2026-08-12", title: "IPPT", team: null, platoons: [{ name: "PLATOON 6", camps: [{ name: "SLR", sent: false, men: [] }] }] });
    expect(text).toBe(["120826 IPPT", "", "Participants", "", "Total Strength:", "", "Plt 6:", "", "SLR:"].join("\n"));
    expect(text).not.toMatch(/ \n|\s$/);
  });

  it("Plt from PLATOON, and men in the lists' role order", () => {
    expect(plt("PLATOON 5")).toBe("Plt 5");
    expect(plt("COY HQ")).toBe("COY HQ");
    const men = [
      { name: "A", role: "ST SVC" },
      { name: "B", role: "GC" },
      { name: "C", role: "MP SPEC" },
      { name: "D", role: "ST CBT" },
      { name: "E", role: "GC" },
    ];
    expect(byRole(men).map((m) => m.name)).toEqual(["B", "E", "D", "A", "C"]);
  });
});

describe("set-up's pre-ticks and team", () => {
  // a 3-on 3-off cycle: team A stands 01–03/11, B 04–06/11, from 0800
  const cycle = (campId: string, anchorDate: string): ShiftPattern => ({
    campId,
    kind: "CYCLE",
    onDays: 3,
    offDays: 3,
    anchorDate,
    hotoTime: "0800",
    weekdayMask: 0,
    holidaysOff: false,
    bothOnAllowed: false,
  });
  const camps: SetUpCamp[] = [
    { id: "hq", name: "COY HQ", post: "COY HQ", subunitId: "hq", isHq: true },
    { id: "sfta", name: "SFT A", post: "SFT", subunitId: "p5", isHq: false },
    { id: "sftb", name: "SFT B", post: "SFT", subunitId: "p5", isHq: false },
    { id: "tft", name: "TFT", post: "TFT", subunitId: "p5", isHq: false },
    { id: "pyada", name: "PYAD A", post: "PYAD", subunitId: "p8", isHq: false },
    { id: "pyadb", name: "PYAD B", post: "PYAD", subunitId: "p8", isHq: false },
  ];
  const patterns = new Map([
    ["sfta", cycle("sfta", "2026-11-01")],
    ["sftb", cycle("sftb", "2026-11-04")],
    ["pyada", cycle("pyada", "2026-11-01")],
    ["pyadb", cycle("pyadb", "2026-11-04")],
  ]);

  it("every camp with no partner team, and of each pair the team off at midday; HQ never", () => {
    expect(namedPreTicked(camps, patterns, "2026-11-05")).toEqual(["sfta", "tft", "pyada"]);
    expect(namedPreTicked(camps, patterns, "2026-11-02")).toEqual(["sftb", "tft", "pyadb"]);
  });

  it("a pair with no patterns is left for the PS", () => {
    expect(namedPreTicked(camps, new Map(), "2026-11-05")).toEqual(["tft"]);
  });

  it("the team most ticked pairs belong to; none on a tie or with no pairs", () => {
    expect(teamOf("SFT A")).toBe("A");
    expect(teamOf("TFT")).toBeNull();
    expect(teamFor(camps, ["sfta", "tft", "pyada"])).toBe("A");
    expect(teamFor(camps, ["sfta", "pyadb"])).toBeNull();
    expect(teamFor(camps, ["tft"])).toBeNull();
  });
});

describe("conductInput for a named list", () => {
  const parse = (over: Record<string, unknown>) =>
    conductInput("2026-11-02").safeParse({ kind: "NAMED", title: "", date: "2026-11-06", reportBy: "1800", campIds: ["0b8f6b1e-3c55-4b47-9a3e-2b8f7a1c1d11"], ...over });

  it("OSE's title by default, due the day before (or the day, when that's today)", () => {
    expect(parse({}).data).toMatchObject({ title: "OSE & COMD TRAINING", dueDate: "2026-11-05", team: null });
    expect(parse({ date: "2026-11-02" }).data?.dueDate).toBe("2026-11-02");
    expect(parse({ title: "ippt", team: "B" }).data).toMatchObject({ title: "IPPT", team: "B" });
  });

  it("due from today to the conduct's day, still a week ahead at most", () => {
    expect(parse({ dueDate: "2026-11-02" }).success).toBe(true);
    expect(parse({ dueDate: "2026-11-06" }).success).toBe(true);
    expect(parse({ dueDate: "2026-11-01" }).success).toBe(false);
    expect(parse({ dueDate: "2026-11-07" }).success).toBe(false);
    expect(parse({ date: "2026-11-10" }).success).toBe(false);
  });

  it("a strength has no team or due day, whatever is sent", () => {
    expect(parse({ kind: "STRENGTH", team: "A", dueDate: "2026-11-03" }).data).toMatchObject({ title: "CPT PARTICIPATING STRENGTH", team: null, dueDate: null });
  });
});

describe("a parade-state entry on a day", () => {
  const a = (startDate: string | null, endDate: string | null, endTime: string | null = null, type: SnapshotAbsence["type"] = "AL"): SnapshotAbsence => ({
    id: "a",
    type,
    otherReason: "",
    startDate,
    startTime: null,
    endDate,
    endTime,
    maTiming: "",
    maLocation: "",
  });

  it("touches the day if any of it falls inside; an end at midnight is the day before's", () => {
    const covers = (x: SnapshotAbsence) => v1CoversDay(x, "2026-11-05", "2026-11-03");
    expect(covers(a("2026-11-05", "2026-11-07"))).toBe(true);
    expect(covers(a("2026-11-06", "2026-11-07"))).toBe(false);
    expect(covers(a("2026-11-01", "2026-11-04"))).toBe(false);
    expect(covers(a("2026-11-01", "2026-11-05", "0000"))).toBe(false);
    expect(covers(a("2026-11-01", "2026-11-05", "0900"))).toBe(true);
    expect(covers(a(null, null, null, "OTHERS"))).toBe(true);
  });

  it("an undated MA is today's appointment only", () => {
    expect(v1CoversDay(a(null, null, null, "MA"), "2026-11-05", "2026-11-03")).toBe(false);
    expect(v1CoversDay(a(null, null, null, "MA"), "2026-11-03", "2026-11-03")).toBe(true);
    expect(v1CoversDay(a("2026-11-05", null, null, "MA"), "2026-11-05", "2026-11-03")).toBe(true);
  });
});

describe("the DM and Needs you", () => {
  const c = { title: "OSE & COMD TRAINING", date: "2026-11-06", team: "A", dueDate: "2026-11-05", reportBy: "1800" };

  it("the DM names the camp, the team and when", () => {
    expect(dueLabel(c)).toBe("051126 1800H");
    expect(namedAskText(c, "SLR")).toMatch(/^📋 Name SLR's men for 061126 OSE & COMD TRAINING \(Team A\), by 051126 1800H\./);
    expect(namedAskText(c, "SLR", true)).toMatch(/^⏰ Still waiting for SLR's men/);
  });

  it("a named list waiting on his camps is its own line, next to a strength", () => {
    const lines = needsYou({
      pending: [],
      short: [],
      companyOnly: false,
      now: new Date(),
      today: "2026-11-02",
      strengths: [
        { id: "s1", campName: "SLR", reportBy: "1830" },
        { id: "n1", campName: "SLR", reportBy: "1800", kind: "NAMED", date: "2026-11-06", dueDate: "2026-11-05" },
      ],
    });
    expect(lines).toEqual([
      { kind: "strength", text: "Send SLR strength · due 1830H", href: "/tg/conducts/camp/s1" },
      { kind: "names", text: "Name SLR's men · due 051126 1800H", href: "/tg/conducts/camp/n1" },
    ]);
  });
});
