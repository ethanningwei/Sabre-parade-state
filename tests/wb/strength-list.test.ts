import { describe, expect, it } from "vitest";
import type { SnapshotAbsence } from "@/lib/parade/types";
import { dayRange, statusReason, strengthGroups, strengthText, v1Covers, v1Reason, type StrengthMan } from "@/lib/wb/domain/strength-list";

const man = (name: string, role: string, over: Partial<StrengthMan> = {}): StrengthMan => ({
  personId: name.toLowerCase(),
  rank: name.split(" ")[0],
  name: name.split(" ").slice(1).join(" "),
  role,
  away: null,
  status: null,
  ...over,
});

// BDK's CPT strength of 18/06, as posted in Commanders of N23 (Fitri), but
// with the LD men left out of the count (the user, 2026-11-02)
const bdk: StrengthMan[] = [
  man("3SG JAYVEN", "GC"),
  man("3SG HAKIMI", "GUARD COMM"),
  man("3SG FITRI", "GC"),
  man("3SG NAZIM", "GC", { away: "MA @CGH" }),
  man("LCP RYAN", "ST CBT"),
  man("LCP PHONE", "CBT"),
  man("LCP MATTHEW", "ST CBT"),
  man("LCP EE MING", "ST CBT", { away: "IPPT 190626" }),
  man("LCP ANSHUM", "ST CBT", { status: "LD 180626-190626" }),
  man("PTE LOU YU", "ST SVC", { away: "HL 100626-180626" }),
  man("PTE LUKE", "ST SVC"),
];

describe("strength list", () => {
  it("groups by role, roster order within, and counts only those going", () => {
    const groups = strengthGroups(bdk, {});
    expect(groups.map((g) => [g.label, g.going, g.lines.length])).toEqual([
      ["GC", 3, 4],
      ["CBT", 3, 5],
      ["SVC", 1, 2],
    ]);
  });

  it("the GC's taps: a reason for one, going after all for another", () => {
    const groups = strengthGroups(bdk, {
      "lcp matthew": { going: false, reason: "driving" },
      "pte luke": { going: false, reason: "National tennis training" },
      "3sg nazim": { going: true },
    });
    expect(strengthText({ date: "2026-06-18", title: "CPT PARTICIPATING STRENGTH", campName: "BDK", groups })).toBe(
      [
        "180626 CPT PARTICIPATING STRENGTH",
        "",
        "BDK (6/11)",
        "",
        "GC: 04/04",
        "1. 3SG JAYVEN",
        "2. 3SG HAKIMI",
        "3. 3SG FITRI",
        "4. 3SG NAZIM",
        "",
        "CBT: 02/05",
        "1. LCP RYAN",
        "2. LCP PHONE",
        "3. LCP MATTHEW (DRIVING)",
        "4. LCP EE MING (IPPT 190626)",
        "5. LCP ANSHUM (LD 180626-190626)",
        "",
        "SVC: 00/02",
        "1. PTE LOU YU (HL 100626-180626)",
        "2. PTE LUKE (NATIONAL TENNIS TRAINING)",
      ].join("\n"),
    );
  });

  it("an away reason wins over a status; other roles come after SVC; a blank title is CPT's", () => {
    const groups = strengthGroups([man("3SG HARRY", "MP SPEC"), man("PTE X", "ST SVC", { away: "MC 180626", status: "LD" }), man("CPL Y", "")], {});
    expect(groups.map((g) => g.label)).toEqual(["SVC", "MP SPEC", "OTHERS"]);
    expect(groups[0].lines[0].reason).toBe("MC 180626");
    expect(strengthText({ date: "2026-06-18", title: " ", campName: "PYAD A", groups }).split("\n")[0]).toBe("180626 CPT PARTICIPATING STRENGTH");
  });

  it("dates: one day, a range, and an end at midnight is the day before", () => {
    expect(dayRange({ date: "2026-08-11" }, { date: "2026-08-11", time: "2359" })).toBe("110826");
    expect(dayRange({ date: "2026-08-11" }, { date: "2026-08-13", time: "2359" })).toBe("110826-130826");
    expect(dayRange({ date: "2026-08-11" }, { date: "2026-08-14", time: "0000" })).toBe("110826-130826");
    expect(dayRange({ date: "2026-08-11" }, null)).toBe("110826");
    expect(statusReason("LIGHT DUTY", "180626-190626")).toBe("LD 180626-190626");
    expect(statusReason("excuse rmj", "")).toBe("EXCUSE RMJ");
  });

  it("the parade state's own entries: only while they cover the moment, written the lists' way", () => {
    const a = (over: Partial<SnapshotAbsence>): SnapshotAbsence => ({ id: "a", type: "MC", otherReason: "", startDate: null, startTime: null, endDate: null, endTime: null, maTiming: "", maLocation: "", ...over });
    const at = { date: "2026-11-02", time: "1845" };
    // an MC that ended in September, and one not started yet, aren't why he's away tonight
    expect(v1Covers(a({ startDate: "2026-09-29", endDate: "2026-09-30" }), at)).toBe(false);
    expect(v1Covers(a({ startDate: "2026-11-03", endDate: "2026-11-04" }), at)).toBe(false);
    expect(v1Covers(a({ startDate: "2026-11-02", startTime: "1900", endDate: "2026-11-02" }), at)).toBe(false);
    expect(v1Covers(a({ startDate: "2026-11-01", endDate: "2026-11-02", endTime: "0000" }), at)).toBe(false);
    expect(v1Covers(a({ startDate: "2026-11-01", endDate: "2026-11-02" }), at)).toBe(true);
    expect(v1Covers(a({ type: "OTHERS", otherReason: "MP60" }), at)).toBe(true);
    expect(v1Reason(a({ startDate: "2026-11-01", endDate: "2026-11-02" }))).toBe("MC 011126-021126");
    expect(v1Reason(a({ type: "OTHERS", otherReason: "cbt course", startDate: "2026-09-14", endDate: "2026-11-06" }))).toBe("CBT COURSE 140926-061126");
    expect(v1Reason(a({ type: "OTHERS", otherReason: "MP60" }))).toBe("MP60");
    expect(v1Reason(a({ type: "MA", maTiming: "0930", maLocation: "cgh" }))).toBe("MA @CGH");
  });
});
