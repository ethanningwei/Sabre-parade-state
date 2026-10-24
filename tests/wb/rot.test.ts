import { describe, expect, it } from "vitest";
import { cleanName, isSvc, sectionCampName } from "@/lib/wb/domain/rot";
import { place } from "@/lib/wb/format";

// ROT's small pure rules: names, who leaves, and how a section's camp reads.

describe("ROT names", () => {
  it("a section's camp is unique in the coy and reads as its section everywhere", () => {
    expect(sectionCampName("PLATOON 1", "SECTION 2")).toBe("PLATOON 1 SECTION 2");
    expect(place("PLATOON 1 SECTION 2", "PLATOON 1")).toBe("SECTION 2 · PLATOON 1");
    // Vigilance's as before
    expect(place("SFT A", "PLATOON 5")).toBe("SFT A · PLATOON 5");
    expect(place("COY HQ", "COY HQ")).toBe("COY HQ");
    expect(place(null, "PLATOON 5")).toBe("PLATOON 5");
  });

  it("typed names are tidied; SVC troopers are told apart however v1 spells it", () => {
    expect(cleanName("  platoon   3 ")).toBe("PLATOON 3");
    expect(["SVC", "ST SVC", "sec tpr svc", "svc "].every(isSvc)).toBe(true);
    expect(["CBT", "GUARD COMM", "", "SC"].some(isSvc)).toBe(false);
  });
});
