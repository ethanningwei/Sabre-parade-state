import { describe, expect, it } from "vitest";
import { canRemoveFromRoster, inRosterScope, isWaiting, removalLines, removalRefusal, rosterReach, rosterReachLabel, seesRoster, similarName } from "@/lib/wb/domain/roster-flow";

const PL5 = "pl5";
const PL6 = "pl6";
const SLR = "slr";
const where = { subunitId: PL6, campId: SLR };

describe("isWaiting", () => {
  const at = new Date();
  it("is registered, unlinked and without a grant", () => {
    expect(isWaiting({ registeredAt: at, personId: null, grants: [] })).toBe(true);
  });
  it("not before registering, once linked, or with any grant (an admin can't lock himself out)", () => {
    expect(isWaiting({ registeredAt: null, personId: null, grants: [] })).toBe(false);
    expect(isWaiting({ registeredAt: at, personId: "p", grants: [] })).toBe(false);
    expect(isWaiting({ registeredAt: at, personId: null, grants: [{ role: "ADMIN", subunitId: null, campId: null }] })).toBe(false);
  });
});

describe("Roster scope", () => {
  it("company-wide sees everyone, even someone with no camp", () => {
    const oc = [{ role: "OC" as const, subunitId: null, campId: null }];
    expect(rosterReach(oc)).toBe(true);
    expect(inRosterScope(oc, { subunitId: null, campId: null })).toBe(true);
  });
  it("a platoon grant sees its platoon; a camp grant its camp", () => {
    const ps = [{ role: "PS" as const, subunitId: PL6, campId: null }];
    expect(inRosterScope(ps, where)).toBe(true);
    expect(inRosterScope(ps, { subunitId: PL5, campId: "bdk" })).toBe(false);
    expect(inRosterScope(ps, { subunitId: null, campId: null })).toBe(false);
    expect(inRosterScope([{ role: "ASA", subunitId: null, campId: SLR }], where)).toBe(true);
    expect(rosterReach(ps)).toEqual({ subunitIds: [PL6], campIds: [] });
    expect(rosterReachLabel(ps)).toBe("Your platoon");
  });
  it("a GC sees his own camp only, however his grant was given", () => {
    const gc = [{ role: "GC" as const, subunitId: null, campId: SLR }];
    expect(inRosterScope(gc, where)).toBe(true);
    expect(inRosterScope(gc, { subunitId: PL6, campId: "srfa" })).toBe(false);
    expect(rosterReachLabel(gc)).toBe("Your camp");
    expect(seesRoster(gc)).toBe(true);
    const wide = [{ role: "GC" as const, subunitId: null, campId: null }];
    expect(inRosterScope(wide, where)).toBe(false);
    expect(seesRoster(wide)).toBe(false);
    expect(seesRoster([{ role: "PS" as const, subunitId: PL6, campId: null }])).toBe(true);
    expect(seesRoster([])).toBe(false);
  });
});

describe("canRemoveFromRoster", () => {
  it("his platoon's PC or PS, or company command and admins", () => {
    expect(canRemoveFromRoster([{ role: "PS", subunitId: PL6, campId: null }], where)).toBe(true);
    expect(canRemoveFromRoster([{ role: "PC", subunitId: PL6, campId: null }], where)).toBe(true);
    expect(canRemoveFromRoster([{ role: "CSM", subunitId: null, campId: null }], where)).toBe(true);
    expect(canRemoveFromRoster([{ role: "ADMIN", subunitId: null, campId: null }], where)).toBe(true);
  });
  it("not another platoon's PS, a GC or an ASA", () => {
    expect(canRemoveFromRoster([{ role: "PS", subunitId: PL5, campId: null }], where)).toBe(false);
    expect(canRemoveFromRoster([{ role: "GC", subunitId: null, campId: SLR }], where)).toBe(false);
    expect(canRemoveFromRoster([{ role: "ASA", subunitId: null, campId: null }], where)).toBe(false);
  });
  it("refuses yourself and the last admin", () => {
    expect(removalRefusal({ self: true, lastAdmin: false })).toMatch(/yourself/);
    expect(removalRefusal({ self: false, lastAdmin: true })).toMatch(/last Sabre admin/);
    expect(removalRefusal({ self: false, lastAdmin: false })).toBeNull();
  });
});

describe("removalLines", () => {
  it("lists only what's there, and what stays", () => {
    const r = removalLines({ absences: 1, duties: 0, assignments: 2, pending: 1, grants: ["PS · PLATOON 6"], account: true, ahead: 1 });
    expect(r.will).toEqual([
      "Off the parade state: never counted again",
      "1 open absence on the parade state closed",
      "2 Extra/RF/SOL in Sabre stood down",
      "1 request waiting on a decision withdrawn",
      "Roles taken away: PS · PLATOON 6",
      "His Sabre account switched off",
    ]);
    expect(r.keeps).toEqual(["1 approved entry still to come (not cancelled)", "His records, as history"]);
    expect(removalLines({ absences: 0, duties: 0, assignments: 0, pending: 0, grants: [], account: false, ahead: 0 }).will).toHaveLength(1);
  });
});

describe("similarName", () => {
  it("one contains the other, or they share a word of 3+ letters", () => {
    expect(similarName("TAN", "TAN AH KOW")).toBe(true);
    expect(similarName("ah kow tan", "TAN AH KOW")).toBe(true);
    expect(similarName("Muhammad Irfan", "IRFAN")).toBe(true);
    expect(similarName("JOHN LIM", "LIM WEI JIE")).toBe(true);
  });
  it("not on short words alone or unrelated names", () => {
    expect(similarName("AH BOY", "TAN AH KOW")).toBe(false); // "AH" is shared, but too short to mean anything
    expect(similarName("BOB", "TAN AH KOW")).toBe(false);
    expect(similarName("", "TAN")).toBe(false);
  });
});
