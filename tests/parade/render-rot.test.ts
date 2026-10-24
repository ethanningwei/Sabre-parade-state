import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderParadeState, validate } from "@/lib/parade";
import { renderRotParadeState } from "@/lib/parade/render-rot";
import type { CoySnapshot } from "@/lib/parade/types";
import { draftSnapshot, rotSnapshot, sectionLabel, sectionOrder, rosterOrder } from "@/lib/wb/domain/rot";
import { absent, camp, duty, exampleSnapshot, present, subunit } from "../fixtures/example-snapshot";

// PROVISIONAL golden: hand-written from the confirmed shape (phases-plan §2,
// the mockup's "Preview the ROT parade state"), not a real ROT parade state.
// Replace it when the real one arrives (phases-plan §4 #1).
const golden = readFileSync(join(__dirname, "../fixtures/rot-example.txt"), "utf8");
const CAA = { date: "2026-11-03", time: "0800" };

/** A company after the switch, as v1 holds it: the Vigilance camps still there (hidden), sections named "PLATOON 1 SECTION 1". */
function afterSwitch(): CoySnapshot {
  return {
    coy: { id: "c", key: "SABRE", displayName: "Sabre" },
    subunits: [
      subunit(
        "COY HQ",
        [
          camp("COY HQ", [
            ...present("HQ", 3),
            absent("3SG ALPHA TAN", { type: "OL", start: "011126", end: "081126" }),
            absent("CPL BRAVO LIM", { type: "MC", start: "021126", end: "041126" }),
          ]),
        ],
        true,
      ),
      subunit("PLATOON 5", [camp("SFT A", [], false), camp("SFT B", [])]),
      subunit("PLATOON 1", [
        camp("PLATOON 1 SECTION 1", [...present("S11", 3), absent("PTE CHARLIE ONG", { type: "MC", start: "021126", end: "031126" })]),
        camp("PLATOON 1 SECTION 2", [
          ...present("S12", 1),
          absent("PTE ECHO PEH", { type: "MA", maTiming: "0900", maLocation: "CMPB" }),
          absent("PTE DELTA NG", { type: "AL", start: "011126", end: "051126" }),
        ]),
      ]),
      subunit("PLATOON 2", [
        camp("PLATOON 2 SECTION 1", present("S21", 3)),
        camp("PLATOON 2 SECTION 2", [...present("S22", 1), absent("LCP FOXTROT LEE", { type: "OTHERS", reason: "CBT COURSE", start: "141026", end: "061126" })]),
      ]),
    ],
    duties: [duty("SOL", "PTE OLD SOL", "SFT B", "011126", "101126"), duty("EXTRA", "PTE NEW EXTRA", "PLATOON 1 SECTION 1", "021126", "041126")],
  };
}
const HIDDEN = ["camp:SFT A", "camp:SFT B"];

describe("renderRotParadeState (provisional format)", () => {
  it("matches the hand-written ROT golden text character for character", () => {
    const s = rotSnapshot(afterSwitch(), HIDDEN);
    expect(validate(s, CAA)).toEqual([]);
    expect(renderRotParadeState(s, CAA)).toBe(golden);
  });

  it("has no Platoon HQ, Off Shift or RF, and counts no Extra/RF/SOL", () => {
    const text = renderRotParadeState(rotSnapshot(afterSwitch(), HIDDEN), CAA);
    expect(text).not.toMatch(/Off Shift|RF|Serving|SOL|EXTRA|PLATOON 5|SFT/);
  });

  it("prints COY HQ as Vigilance does, off shift included", () => {
    const s = exampleSnapshot();
    const hq = s.subunits.filter((x) => x.isHq);
    const vigilance = renderParadeState({ ...s, subunits: hq, duties: [] }, CAA);
    expect(renderRotParadeState({ ...s, subunits: hq, duties: [] }, CAA)).toBe(vigilance);
    const off = { ...s, subunits: [{ ...hq[0], camps: [{ ...hq[0].camps[0], onShift: false }] }], duties: [] };
    expect(renderRotParadeState(off, CAA)).toBe(renderParadeState(off, CAA));
  });
});

describe("rotSnapshot", () => {
  it("hides the switched-off camps and empty platoons, relabels sections, drops Extra/RF/SOL", () => {
    const s = rotSnapshot(afterSwitch(), HIDDEN);
    expect(s.subunits.map((x) => [x.name, x.camps.map((c) => c.name)])).toEqual([
      ["COY HQ", ["COY HQ"]],
      ["PLATOON 1", ["SECTION 1", "SECTION 2"]],
      ["PLATOON 2", ["SECTION 1", "SECTION 2"]],
    ]);
    expect(s.duties).toEqual([]);
  });

  it("keeps a camp it wasn't told to hide, under its own name", () => {
    const s = rotSnapshot(afterSwitch(), ["camp:SFT A"]);
    expect(s.subunits.find((x) => x.name === "PLATOON 5")?.camps.map((c) => c.name)).toEqual(["SFT B"]);
  });

  it("sectionLabel strips only its own platoon's prefix", () => {
    expect(sectionLabel("PLATOON 1 SECTION 3", "PLATOON 1")).toBe("SECTION 3");
    expect(sectionLabel("PLATOON 10 SECTION 3", "PLATOON 1")).toBe("PLATOON 10 SECTION 3");
    expect(sectionLabel("SLR", "PLATOON 6")).toBe("SLR");
    expect(sectionLabel("PLATOON 1 ", "PLATOON 1")).toBe("PLATOON 1 ");
  });
});

describe("draftSnapshot (the preview)", () => {
  it("prints COY HQ as it is and the drafted sections with today's absences; SCs first, then roster order", () => {
    const s = exampleSnapshot();
    const slr = s.subunits.find((x) => x.name === "PLATOON 6")!.camps.find((c) => c.name === "SLR")!.people;
    const [irfan, weiHao, joshua] = slr;
    const { snapshot, unplaced } = draftSnapshot(s, [
      { id: "p1", name: "PLATOON 1", sections: [{ id: "s1", name: "SECTION 1", personIds: [joshua.id, weiHao.id, irfan.id], scIds: [joshua.id] }] },
    ]);
    expect(snapshot.subunits.map((x) => x.name)).toEqual(["COY HQ", "PLATOON 1"]);
    expect(snapshot.subunits[1].camps[0].people.map((p) => p.name)).toEqual(["JOSHUA LAU", "IRFAN", "WEI HAO"]);
    const total = s.subunits.filter((x) => !x.isHq).reduce((n, x) => n + x.camps.reduce((m, c) => m + c.people.length, 0), 0);
    expect(unplaced).toBe(total - 3);
    const text = renderRotParadeState(snapshot, CAA);
    expect(text).toContain("PLATOON 1\n• Total strength: 3\n• Present strength: 0\n\nSECTION 1\n• Total Strength: 03\n• Present Strength: 00\n");
  });

  it("sectionOrder puts unknown men last", () => {
    const order = rosterOrder(exampleSnapshot());
    expect(sectionOrder(["x", "y"], ["y"], order)).toEqual(["y", "x"]);
  });
});
