import { describe, expect, it } from "vitest";
import { isWaiting, removalLines, removalRefusal, similarName } from "@/lib/wb/domain/roster-flow";

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

describe("removalRefusal", () => {
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
