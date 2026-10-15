// Transport claims, pure: the office address per camp, the days, never the
// past, the sheet row by header with the OC's columns untouched, and reading
// his verdicts back by key wherever his script moved the row.
import { describe, expect, it } from "vitest";
import {
  CLAIM_HEADERS,
  claimDates,
  claimDays,
  claimKey,
  columnLetter,
  headerIndex,
  officeAddress,
  placeText,
  requestStamp,
  rowSpan,
  sheetRow,
  slashDate,
  verdictsByKey,
  verdictText,
} from "@/lib/wb/domain/claims";
import { ClaimSheet, memorySheet } from "@/lib/wb/sheets";

const row = (over: Partial<Parameters<typeof sheetRow>[0]> = {}) =>
  sheetRow({
    rank: "CPL",
    name: "XU CHENXI",
    platoon: "PLATOON 6",
    vehicle: "PRIVATE HIRE VEHICLE",
    tripDate: "2026-10-19",
    startPlace: "SELARANG CAMP",
    endPlace: "CLEMENTI CAMP",
    reason: "AFFC TRAINING",
    roundTrip: true,
    requested: "14/10/2026 14:21",
    ...over,
  });

describe("office address", () => {
  it("drops a pair's team and uses the sheet's spelling", () => {
    expect(officeAddress("SRF A")).toBe("SELARANG CAMP");
    expect(officeAddress("SRF B")).toBe("SELARANG CAMP");
    expect(officeAddress("SLR")).toBe("SELARANG CAMP");
    expect(officeAddress("HDN")).toBe("HENDON CAMP");
    expect(officeAddress("BDK")).toBe("BEDOK CAMP");
    expect(officeAddress("PYAD A")).toBe("PYAD");
    expect(officeAddress("COY HQ")).toBe("CLEMENTI CAMP");
  });
  it("falls back to the camp's own name", () => {
    expect(officeAddress("maju")).toBe("MAJU");
  });
  it("places: home is the word HOME, typed text is upper-cased", () => {
    expect(placeText({ kind: "HOME" }, "BEDOK CAMP")).toBe("HOME");
    expect(placeText({ kind: "OFFICE" }, "BEDOK CAMP")).toBe("BEDOK CAMP");
    expect(placeText({ kind: "OTHER", text: "  singapore   general hospital " }, "X")).toBe("SINGAPORE GENERAL HOSPITAL");
  });
});

describe("days", () => {
  it("offers the fortnight after the first day", () => {
    const days = claimDays("2026-10-30");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-10-31");
    expect(days[13]).toBe("2026-11-13");
  });
  it("today counts, the past never does", () => {
    expect(claimDates("2026-10-15", [], "2026-10-15")).toEqual(["2026-10-15"]);
    expect(claimDates("2026-10-14", [], "2026-10-15")).toBeNull();
  });
  it("dedupes and sorts, and refuses a day outside the fortnight", () => {
    expect(claimDates("2026-10-15", ["2026-10-17", "2026-10-16", "2026-10-17"], "2026-10-15")).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(claimDates("2026-10-15", ["2026-10-15"], "2026-10-15")).toBeNull();
    expect(claimDates("2026-10-15", ["2026-10-30"], "2026-10-15")).toBeNull();
  });
});

describe("the sheet row", () => {
  it("is the sheet's shape: DD/MM/YYYY, YES/NO, a request stamp in SGT", () => {
    expect(slashDate("2026-10-05")).toBe("05/10/2026");
    expect(requestStamp(new Date("2026-10-14T06:21:00Z"))).toBe("14/10/2026 14:21");
    expect(row()).toMatchObject({ "DATE OF TRANSPORT": "19/10/2026", "ROUND TRIP": "YES", NAME: "XU CHENXI" });
  });
  it("spans from RANK to DATE OF REQUEST, never the OC's three columns", () => {
    const idx = headerIndex(CLAIM_HEADERS);
    const { first, values } = rowSpan(idx, row());
    expect(first).toBe(3);
    expect(values).toEqual(["CPL", "XU CHENXI", "PLATOON 6", "PRIVATE HIRE VEHICLE", "19/10/2026", "SELARANG CAMP", "CLEMENTI CAMP", "AFFC TRAINING", "YES", "14/10/2026 14:21"]);
  });
  it("follows the headers if the OC reorders columns, and refuses to blank his", () => {
    const moved = ["RANK", "NAME", "OC APPROVAL", "PLATOON", "VEHICLE TYPE", "DATE OF TRANSPORT", "START LOCATION", "END LOCATION", "REASON", "ROUND TRIP", "DATE OF REQUEST"];
    expect(() => rowSpan(headerIndex(moved), row())).toThrow(/OC APPROVAL/);
    expect(() => headerIndex(["OC APPROVAL", "NAME"])).toThrow(/no RANK/);
  });
  it("column letters", () => {
    expect([0, 3, 12, 25, 26, 27].map(columnLetter)).toEqual(["A", "D", "M", "Z", "AA", "AB"]);
  });
});

describe("reading verdicts back", () => {
  const head = [...CLAIM_HEADERS];
  const line = (verdict: string, remarks: string, r = row()) => [verdict, remarks, "", ...Object.values(r)];
  it("finds a row in any tab, by whose, which day and when asked", () => {
    const found = verdictsByKey([
      [head, line("", "")],
      [head, line("APPROVED", "Indicate pre-course admin", row({ tripDate: "2026-10-20" }))],
      [["Something else"], ["x"]],
    ]);
    expect(found.get(claimKey("XU CHENXI", "19/10/2026", "14/10/2026 14:21"))).toEqual([null]);
    expect(found.get(claimKey("XU CHENXI", "20/10/2026", "14/10/2026 14:21"))).toEqual([{ state: "APPROVED", remarks: "Indicate pre-course admin" }]);
  });
  it("matches a moved row that lost its leading zeros", () => {
    const r = { ...row({ tripDate: "2026-10-05" }), "DATE OF TRANSPORT": "5/10/2026", "DATE OF REQUEST": "4/10/2026 9:05" };
    const found = verdictsByKey([[head, line("REJECTED", "", r)]]);
    expect(found.get(claimKey("XU CHENXI", "05/10/2026", "04/10/2026 09:05"))).toEqual([{ state: "REJECTED", remarks: "" }]);
  });
  it("the trooper's message groups by verdict", () => {
    const base = { vehicle: "TAXI", startPlace: "HOME", endPlace: "SELARANG CAMP", reason: "CT SCAN", roundTrip: false, remarks: "" };
    const text = verdictText([
      { ...base, tripDate: "2026-10-19", state: "APPROVED" },
      { ...base, tripDate: "2026-10-20", state: "REJECTED", remarks: "Take the bus" },
    ]);
    expect(text).toBe("✅ Transport claim approved\n\n• TAXI 19/10 · HOME → SELARANG CAMP · CT SCAN\n\n❌ Transport claim rejected\n\n• TAXI 20/10 · HOME → SELARANG CAMP · CT SCAN\n  OC: Take the bus");
  });
});

describe("ClaimSheet over a sheet in memory", () => {
  it("appends below the last row and leaves the OC's columns alone", async () => {
    const mem = memorySheet({
      "Pending Requests": [[...CLAIM_HEADERS], ["", "", "", "LCP", "DYNOH", "PLATOON 7", "TAXI", "14/10/2026", "OSU", "HOME", "RF", "NO", "14/10/2026 16:57"]],
      "Processed Requests": [[...CLAIM_HEADERS], ["APPROVED", "ok", "", ...Object.values(row({ tripDate: "2026-10-21" }))]],
    });
    const sheet = new ClaimSheet(mem, "Pending Requests");
    expect(await sheet.add([row(), row({ tripDate: "2026-10-20" })])).toEqual([3, 4]);
    const pending = mem.tabs["Pending Requests"];
    expect(pending[2].slice(0, 3)).toEqual(["", "", ""]);
    expect(pending[2][7]).toBe("19/10/2026");
    expect(pending[3][7]).toBe("20/10/2026");
    const v = await sheet.verdicts();
    expect(v.get(claimKey("XU CHENXI", "21/10/2026", "14/10/2026 14:21"))).toEqual([{ state: "APPROVED", remarks: "ok" }]);
    expect(v.get(claimKey("XU CHENXI", "19/10/2026", "14/10/2026 14:21"))).toEqual([null]);
  });
  it("refuses a tab with no header row", async () => {
    await expect(new ClaimSheet(memorySheet({}), "Pending Requests").add([row()])).rejects.toThrow(/no header row/);
  });
});
