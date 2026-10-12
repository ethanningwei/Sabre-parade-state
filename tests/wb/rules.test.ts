import { describe, expect, it } from "vitest";
import { clashLines, type ClashDuty, type ClashRecord } from "@/lib/wb/domain/clash";
import { eventDetail, overseasWhere, recordLine, recordWhat } from "@/lib/wb/domain/describe";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { holidayOn } from "@/lib/wb/domain/holidays";
import {
  accessTo,
  canDecide,
  canProxy,
  decidesAnything,
  initialState,
  leaveChange,
  leaveRefusal,
  nextState,
  undoRefusal,
  UNDO_WINDOW_MS,
  WB_RECORD_STATES,
  type RecordAction,
} from "@/lib/wb/domain/rules";
import { dateRange, stampRange } from "@/lib/wb/domain/timeline";

const PL6 = { subunitId: "pl6", campId: "sft-a" };
const g = (role: GrantRow["role"], scope: Partial<GrantRow> = {}): GrantRow => ({ role, subunitId: null, campId: null, ...scope });

describe("rules: who decides", () => {
  it.each([
    ["PS of the platoon", [g("PS", { subunitId: "pl6" })], true],
    ["PC of the platoon", [g("PC", { subunitId: "pl6" })], true],
    ["PS of another platoon", [g("PS", { subunitId: "pl5" })], false],
    ["OC company-wide", [g("OC")], true],
    ["CSM company-wide", [g("CSM")], true],
    ["2IC company-wide", [g("2IC")], true],
    ["OC scoped to a platoon (company roles must be company-wide)", [g("OC", { subunitId: "pl5" })], false],
    ["GC of the camp", [g("GC", { campId: "sft-a" })], false],
    ["ASA", [g("ASA")], false],
    ["ADMIN", [g("ADMIN")], false],
    ["nobody", [], false],
  ])("%s → %s", (_tag, grants, want) => {
    expect(canDecide(grants, PL6)).toBe(want);
  });

  it("decidesAnything: any PC/PS, or company HQ", () => {
    expect(decidesAnything([g("PS", { subunitId: "pl5" })])).toBe(true);
    expect(decidesAnything([g("GC", { campId: "x" }), g("ADMIN")])).toBe(false);
  });

  it("a camp's GC can add events for that camp only", () => {
    expect(canProxy([g("GC", { campId: "sft-a" })], PL6)).toBe(true);
    expect(canProxy([g("GC", { campId: "sft-b" })], PL6)).toBe(false);
    expect(canProxy([g("PS", { subunitId: "pl6" })], PL6)).toBe(true);
    expect(canProxy([g("ASA")], PL6)).toBe(false);
  });
});

describe("rules: states", () => {
  it("leave and off wait for a decision; MA and events are recorded", () => {
    expect(["AL", "OL", "OFF", "MA", "EVENT"].map((k) => initialState(k as "AL"))).toEqual(["PENDING", "PENDING", "PENDING", "RECORDED", "RECORDED"]);
  });

  const legal: Record<RecordAction, Record<string, string>> = {
    approve: { PENDING: "APPROVED" },
    reject: { PENDING: "REJECTED" },
    withdraw: { PENDING: "WITHDRAWN" },
    void: { APPROVED: "CANCELLED", RECORDED: "CANCELLED" },
    undo: { APPROVED: "PENDING", REJECTED: "PENDING" },
  };
  for (const [action, ok] of Object.entries(legal) as [RecordAction, Record<string, string>][]) {
    it(`${action}: only from ${Object.keys(ok).join("/")}`, () => {
      for (const s of WB_RECORD_STATES) expect(nextState(s, action)).toBe(ok[s] ?? null);
    });
  }
});

describe("rules: undo", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const decided = { state: "APPROVED" as const, decidedBy: "m1", decidedAt: new Date(now.getTime() - 60_000) };
  it("only the decider, only for ten minutes", () => {
    expect(undoRefusal(decided, "m1", "2SG TAN", now)).toBeNull();
    expect(undoRefusal(decided, "m2", "2SG TAN", now)).toBe("Only 2SG TAN can take that back.");
    expect(undoRefusal({ ...decided, decidedAt: new Date(now.getTime() - UNDO_WINDOW_MS - 1) }, "m1", "2SG TAN", now)).toMatch(/Too late/);
    expect(undoRefusal({ ...decided, state: "PENDING" }, "m1", "x", now)).toMatch(/already waiting/);
    expect(undoRefusal({ ...decided, state: "CANCELLED" }, "m1", "x", now)).toMatch(/can't be taken back/);
  });
});

describe("rules: leave", () => {
  it("approving spends, undoing or voiding an approval refunds, nothing else moves it", () => {
    expect(leaveChange("AL", "PENDING", "approve", 3)).toBe(-3);
    expect(leaveChange("OL", "APPROVED", "undo", 3)).toBe(3);
    expect(leaveChange("AL", "APPROVED", "void", 3)).toBe(3);
    expect(leaveChange("AL", "REJECTED", "undo", 3)).toBe(0); // a rejection never cost anything
    expect(leaveChange("AL", "PENDING", "reject", 3)).toBe(0);
    expect(leaveChange("AL", "PENDING", "withdraw", 3)).toBe(0);
    expect(leaveChange("OFF", "PENDING", "approve", null)).toBe(0);
  });

  it("over-balance is refused, and so is nothing", () => {
    expect(leaveRefusal(3, 3)).toBeNull();
    expect(leaveRefusal(4, 3)).toMatch(/^That's 4 days of leave and you have 3 left/);
    expect(leaveRefusal(0, 3)).toMatch(/at least one day/);
  });
});

describe("clash", () => {
  const rec = (over: Partial<ClashRecord>): ClashRecord => ({
    kind: "AL",
    state: "APPROVED",
    absent: true,
    detail: "",
    location: "",
    maTiming: null,
    ...dateRange("2026-08-27", "2026-08-29"),
    ...over,
  });
  const want = dateRange("2026-08-28", "2026-08-30");

  it("finds live overlapping records, oldest first, and ignores dead or non-absent ones", () => {
    const lines = clashLines(
      want,
      [
        rec({ kind: "OFF", state: "PENDING", ...dateRange("2026-08-29", "2026-08-29") }),
        rec({}),
        rec({ state: "REJECTED" }),
        rec({ state: "CANCELLED" }),
        rec({ state: "WITHDRAWN" }),
        rec({ absent: false }),
        rec({ ...dateRange("2026-09-01", "2026-09-02") }),
      ],
      [],
    );
    expect(lines).toEqual(["AL 27/08–29/08 · approved", "OFF 29/08 · pending"]);
  });

  it("includes open v1 duties, dated or not", () => {
    const duties: ClashDuty[] = [
      { type: "RF", campName: "BDK", startDate: "2026-08-30", startTime: null, endDate: "2026-08-30", endTime: null },
      { type: "SOL", campName: "SFT A", startDate: null, startTime: null, endDate: null, endTime: null },
      { type: "EXTRA", campName: "TFT", startDate: "2026-08-31", startTime: null, endDate: null, endTime: null },
    ];
    expect(clashLines(want, [], duties)).toEqual(["RF @ BDK 30/08", "SOL @ SFT A"]);
  });
});

describe("describe", () => {
  it("one line per kind", () => {
    const base = { detail: "", location: "", maTiming: null };
    expect(recordWhat({ ...base, kind: "AL", ...stampRange("2026-08-27", "2100", "2026-08-29", "2359") })).toBe("AL 27/08 2100–29/08");
    expect(recordWhat({ ...base, kind: "MA", maTiming: "1530", location: "NATIONAL SKIN CENTRE", ...dateRange("2026-08-27", "2026-08-27") })).toBe(
      "MA 27/08 1530H @ NATIONAL SKIN CENTRE",
    );
    expect(recordLine({ ...base, kind: "EVENT", state: "RECORDED", detail: "IPPT @ MAJU CAMP", ...dateRange("2026-08-27", "2026-08-27") })).toBe(
      "IPPT @ MAJU CAMP 27/08 · recorded",
    );
  });

  it("event details read the same whoever enters them", () => {
    expect(eventDetail(" dv driver course", "maju camp ", "0000", "2359")).toBe("DV DRIVER COURSE @ MAJU CAMP");
    expect(eventDetail("IPPT", "Maju", "0800", "1200")).toBe("IPPT @ MAJU 0800-1200H");
    expect(overseasWhere(" bangkok", "thailand")).toBe("BANGKOK, THAILAND");
    expect(overseasWhere("", "Japan")).toBe("JAPAN");
  });

  it("public holidays, including in-lieu Mondays", () => {
    expect(holidayOn("2026-08-09")).toBe("National Day");
    expect(holidayOn("2026-08-10")).toBe("National Day (in lieu)");
    expect(holidayOn("2027-02-08")).toBe("Chinese New Year (in lieu)");
    expect(holidayOn("2026-08-11")).toBeNull();
  });
});

describe("rules: accessTo", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const rec = { subunitId: "pl6", campId: "sft-a", personId: "p1", state: "PENDING" as const, decidedBy: null, decidedAt: null, decisionNote: null };
  const trooper = { id: "m1", personId: "p1", grants: [] };
  const ps = { id: "m2", personId: "p2", grants: [g("PS", { subunitId: "pl6" })] };
  const stranger = { id: "m3", personId: "p3", grants: [g("GC", { campId: "sft-a" })] };

  it("the trooper sees and withdraws his own pending request; the PS decides it; others see nothing", () => {
    expect(accessTo(trooper, rec, now)).toEqual({ view: true, decide: false, undo: false, sayWhy: false, void: false, withdraw: true });
    expect(accessTo(ps, rec, now)).toEqual({ view: true, decide: true, undo: false, sayWhy: false, void: false, withdraw: false });
    expect(accessTo(stranger, rec, now).view).toBe(false);
  });

  it("after a rejection the decider may undo and say why, once", () => {
    const rejected = { ...rec, state: "REJECTED" as const, decidedBy: "m2", decidedAt: new Date(now.getTime() - 1000) };
    expect(accessTo(ps, rejected, now)).toMatchObject({ undo: true, sayWhy: true, void: false, decide: false });
    expect(accessTo(ps, { ...rejected, decisionNote: "short" }, now).sayWhy).toBe(false);
    expect(accessTo(ps, { ...rejected, state: "APPROVED" }, now)).toMatchObject({ undo: true, void: true });
  });
});
