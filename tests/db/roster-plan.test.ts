import { describe, expect, it } from "vitest";
import { editDistance, planRoster, type RosterRow, type SheetRow } from "@/lib/data/roster-plan";

let n = 0;
const cur = (campName: string, name: string, rank = "PTE", role = ""): RosterRow => ({ id: `p${++n}`, campName, name, rank, role });
const row = (campName: string, name: string, rank = "PTE", role = ""): SheetRow => ({ campName, name, rank, role });

describe("planRoster", () => {
  it("keeps a person in the same camp, ignoring case and spacing, and lists rank/role edits", () => {
    const a = cur("SFT A", "TAN AH KOW", "PTE");
    const plan = planRoster([a], [row("SFT A", " tan  ah kow ", "LCP", "GC")]);
    expect(plan.kept).toHaveLength(1);
    expect(plan.kept[0].current).toBe(a);
    expect(plan.kept[0].changes).toEqual([
      { field: "name", from: "TAN AH KOW", to: " tan  ah kow " },
      { field: "rank", from: "PTE", to: "LCP" },
      { field: "role", from: "", to: "GC" },
    ]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it("follows a person who moved camp when the name is unique in the coy", () => {
    const a = cur("SFT A", "HAOYANG");
    const plan = planRoster([a], [row("SFT B", "HAOYANG")]);
    expect(plan.moved).toEqual([{ current: a, sheet: row("SFT B", "HAOYANG"), changes: [] }]);
    expect(plan.kept).toEqual([]);
  });

  it("never guesses between two people with the same name", () => {
    const a = cur("SFT A", "LIM");
    const b = cur("OSU A", "LIM");
    // both moved: which went where can't be told from the name
    const plan = planRoster([a, b], [row("SFT B", "LIM"), row("OSU B", "LIM")]);
    expect(plan.moved).toEqual([]);
    expect(plan.ambiguous).toEqual([{ name: "LIM", current: [a, b], sheet: [row("SFT B", "LIM"), row("OSU B", "LIM")] }]);
  });

  it("still keeps same-name people who stayed in their own camps", () => {
    const a = cur("SFT A", "LIM");
    const b = cur("OSU A", "LIM");
    const plan = planRoster([a, b], [row("SFT A", "LIM"), row("OSU A", "LIM")]);
    expect(plan.kept.map((m) => m.current)).toEqual([a, b]);
    expect(plan.ambiguous).toEqual([]);
  });

  it("reports a duplicate name inside one camp as ambiguous", () => {
    const a = cur("HDN", "ZHARFAN");
    const plan = planRoster([a], [row("HDN", "ZHARFAN"), row("HDN", "ZHARFAN")]);
    expect(plan.kept).toEqual([]);
    expect(plan.ambiguous).toHaveLength(1);
  });

  it("adds and removes the rest, and hints at a likely rename in the same camp", () => {
    const gone = cur("PRC", "MUHAMMAD FAIZAL");
    const left = cur("PRC", "JOHN");
    const plan = planRoster([gone, left], [row("PRC", "MUHAMMAD FAIZAL B ROSLI"), row("BDK", "NEWMAN")]);
    expect(plan.removed).toEqual([gone, left]);
    expect(plan.added).toEqual([row("PRC", "MUHAMMAD FAIZAL B ROSLI"), row("BDK", "NEWMAN")]);
    expect(plan.renameHints).toEqual([{ current: gone, sheet: row("PRC", "MUHAMMAD FAIZAL B ROSLI") }]);
  });

  it("hints at a one-letter typo but not across camps", () => {
    const a = cur("TFT", "HAZIQ");
    expect(planRoster([a], [row("TFT", "HAZIK")]).renameHints).toHaveLength(1);
    expect(planRoster([a], [row("SLR", "HAZIK")]).renameHints).toEqual([]);
  });

  it("lists camps the Sheet no longer has", () => {
    const plan = planRoster([], [], { current: ["SFT A", "OLD CAMP"], sheet: ["SFT A", "NEW CAMP"] });
    expect(plan.campsGone).toEqual(["OLD CAMP"]);
  });
});

describe("editDistance", () => {
  it("counts edits and stops past the limit", () => {
    expect(editDistance("HAZIQ", "HAZIK")).toBe(1);
    expect(editDistance("KOH", "KHO")).toBe(2);
    expect(editDistance("ALPHA", "OMEGA")).toBe(3);
    expect(editDistance("A", "ABCDEF")).toBe(3);
  });
});
