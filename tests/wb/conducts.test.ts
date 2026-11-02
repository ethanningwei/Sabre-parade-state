import { describe, expect, it } from "vitest";
import { sgtToInstant } from "@/lib/parade/time";
import { canNudge, conductInput, coyTotalText, preTicked, rollUp, updatedText, type CampReport } from "@/lib/wb/domain/conducts";
import { WEEKDAYS, type ShiftPattern } from "@/lib/wb/domain/shifts";
import { groupLabel } from "@/lib/wb/domain/strength-list";

// Conducts, the pure parts (slice 2 of docs/conducts-plan.md): which camps
// start ticked, the roll-up's totals, the coy total, Updated, the nudge gap and
// the set-up form's checks.

const at = (date: string, time: string) => sgtToInstant({ date, time });
const weekdays = (campId: string): ShiftPattern => ({
  campId,
  kind: "WEEKLY",
  onDays: 0,
  offDays: 0,
  anchorDate: null,
  hotoTime: "0800",
  weekdayMask: WEEKDAYS,
  holidaysOff: false,
  bothOnAllowed: false,
});
const always = (campId: string): ShiftPattern => ({ ...weekdays(campId), kind: "ALWAYS" });

describe("preTicked", () => {
  const camps = [
    { id: "bdk", isHq: false },
    { id: "slr", isHq: false },
    { id: "kc3", isHq: false },
    { id: "hq", isHq: true },
  ];
  const patterns = new Map([
    ["bdk", weekdays("bdk")],
    ["slr", always("slr")],
    ["hq", weekdays("hq")],
  ]);

  it("ticks the camps off shift that day, never HQ or a camp with no pattern", () => {
    // 2026-11-07 is a Saturday: BDK (weekdays) is off; SLR is always on; KC3 has no pattern
    expect(preTicked(camps, patterns, "2026-11-07")).toEqual(["bdk"]);
  });

  it("ticks nothing on a day everyone stands", () => {
    expect(preTicked(camps, patterns, "2026-11-02")).toEqual([]);
  });
});

const man = (rank: string, name: string, role: string, going: boolean, reason: string | null = null) => ({ rank, name, role, going, reason });
const report = (campName: string, men: CampReport["men"] | null, extra: Partial<CampReport> = {}): CampReport => ({
  campId: campName.toLowerCase(),
  campName,
  reportedAt: men ? at("2026-11-02", "1912") : null,
  reportedBy: men ? "3SG JAYVEN" : null,
  going: men ? men.filter((m) => m.going).length : 0,
  total: men ? men.length : 0,
  nudgedAt: null,
  men: men ?? [],
  ...extra,
});

describe("rollUp", () => {
  const camps = [
    report("BDK", [man("3SG", "JAYVEN", "GC", true), man("3SG", "NAZIM", "GC", false, "MA @CGH"), man("PTE", "HAO YANG", "ST CBT", true)]),
    report("TFT", null),
    report("SLR", [man("PTE", "AKID", "ST SVC", true), man("CPL", "ZANDANI", "ST CBT", false, "MC 070526-090526"), man("LCP", "ANSHUM", "MP SPEC", true)]),
  ];

  it("counts only the camps that sent, by role in the lists' order", () => {
    const r = rollUp(camps, groupLabel);
    expect(r).toMatchObject({ sent: 2, camps: 3, going: 4, total: 6 });
    expect(r.byRole).toEqual([
      { label: "GC", going: 1, total: 2 },
      { label: "CBT", going: 1, total: 2 },
      { label: "SVC", going: 1, total: 1 },
      { label: "MP SPEC", going: 1, total: 1 },
    ]);
    expect(r.out).toEqual([
      { campName: "BDK", rank: "3SG", name: "NAZIM", reason: "MA @CGH" },
      { campName: "SLR", rank: "CPL", name: "ZANDANI", reason: "MC 070526-090526" },
    ]);
  });

  it("the coy total names the camps still waiting", () => {
    expect(coyTotalText({ title: "CPT PARTICIPATING STRENGTH", date: "2026-11-02" }, camps)).toBe(
      ["021126 CPT PARTICIPATING STRENGTH", "TOTAL: 4/6", "", "BDK: 2/3", "TFT: not reported", "SLR: 2/3"].join("\n"),
    );
  });
});

describe("sending again and nudging", () => {
  it("a second send says when it was updated", () => {
    expect(updatedText("021126 CPT\n\nBDK (2/3)", at("2026-11-02", "1931"))).toBe("021126 CPT\n\nBDK (2/3)\n\nUpdated 1931H");
  });

  it("a camp is nudged at most once every 10 minutes", () => {
    const now = at("2026-11-02", "1900");
    expect(canNudge(null, now)).toBe(true);
    expect(canNudge(at("2026-11-02", "1851"), now)).toBe(false);
    expect(canNudge(at("2026-11-02", "1850"), now)).toBe(true);
  });
});

describe("conductInput", () => {
  const parse = (over: Record<string, unknown>) =>
    conductInput("2026-11-02").safeParse({ title: "cpt participating strength", date: "2026-11-02", reportBy: "1830", campIds: ["0b8f6b1e-3c55-4b47-9a3e-2b8f7a1c1d11"], ...over });

  it("upper-cases the title, and an empty one is CPT's", () => {
    expect(parse({}).data?.title).toBe("CPT PARTICIPATING STRENGTH");
    expect(parse({ title: "  " }).data?.title).toBe("CPT PARTICIPATING STRENGTH");
    expect(parse({ title: "ippt" }).data?.title).toBe("IPPT");
  });

  it("today to a week ahead, a real time, at least one camp", () => {
    expect(parse({ date: "2026-11-01" }).success).toBe(false);
    expect(parse({ date: "2026-11-09" }).success).toBe(true);
    expect(parse({ date: "2026-11-10" }).success).toBe(false);
    expect(parse({ reportBy: "2460" }).success).toBe(false);
    expect(parse({ reportBy: "18:30" }).success).toBe(false);
    expect(parse({ campIds: [] }).success).toBe(false);
  });
});
