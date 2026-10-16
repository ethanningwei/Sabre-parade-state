import { describe, expect, it } from "vitest";
import { clashLines, type ClashDuty, type ClashRecord } from "@/lib/wb/domain/clash";
import { eventDetail, overseasWhere, recordLine, recordWhat } from "@/lib/wb/domain/describe";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { holidayOn } from "@/lib/wb/domain/holidays";
import {
  accessTo,
  approverOf,
  canDecide,
  canDecideRequest,
  canForecast,
  canProxy,
  decideRefusalText,
  decidesAnything,
  forecastsAnything,
  initialState,
  leaveChange,
  leaveRefusal,
  needsNoApproval,
  nextState,
  NO_APPROVAL_NOTE,
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

  it("Manpower: deciders, plus a GC for his own camp only (2026-10-16)", () => {
    const gc = [g("GC", { campId: "sft-a" })];
    expect(canForecast(gc, PL6)).toBe(true);
    expect(canForecast(gc, { subunitId: "pl6", campId: "sft-b" })).toBe(false);
    expect(canForecast(gc, { subunitId: "pl5", campId: "bdk" })).toBe(false);
    expect(canForecast([g("GC")], PL6)).toBe(false);
    expect(canForecast([g("PS", { subunitId: "pl6" })], { subunitId: "pl6", campId: "sft-b" })).toBe(true);
    expect(canForecast([g("PS", { subunitId: "pl5" })], PL6)).toBe(false);
    expect(canForecast([g("OC")], PL6)).toBe(true);
    expect(canForecast([g("ASA")], PL6)).toBe(false);
    expect(forecastsAnything(gc)).toBe(true);
    expect(forecastsAnything([g("GC")])).toBe(false);
    expect(forecastsAnything([g("PC", { subunitId: "pl6" })])).toBe(true);
    expect(forecastsAnything([g("ASA"), g("ADMIN")])).toBe(false);
  });

  describe("a request goes to someone above whoever asked (2026-10-14)", () => {
    const req = (personId: string, ownerRoles: GrantRow["role"][]) => ({ ...PL6, personId, ownerRoles });
    const ps = { personId: "ps", grants: [g("PS", { subunitId: "pl6" })] };
    const pc = { personId: "pc", grants: [g("PC", { subunitId: "pl6" })] };
    const oc = { personId: "oc", grants: [g("OC")] };
    const csm = { personId: "csm", grants: [g("CSM")] };

    it("a trooper's or GC's: his PC or PS, or company HQ", () => {
      for (const roles of [[], ["GC"]] as GrantRow["role"][][]) {
        expect(canDecideRequest(ps, req("t", roles))).toBe(true);
        expect(canDecideRequest(pc, req("t", roles))).toBe(true);
        expect(canDecideRequest(oc, req("t", roles))).toBe(true);
      }
    });

    it("a PS's: the PC or company HQ, never another PS", () => {
      expect(canDecideRequest({ personId: "ps2", grants: [g("PS", { subunitId: "pl6" })] }, req("ps", ["PS"]))).toBe(false);
      expect(canDecideRequest(pc, req("ps", ["PS"]))).toBe(true);
      expect(canDecideRequest(csm, req("ps", ["PS"]))).toBe(true);
    });

    it("a PC's: OC, 2IC or CSM only", () => {
      expect(canDecideRequest(ps, req("pc", ["PC"]))).toBe(false);
      expect(canDecideRequest({ personId: "pc2", grants: [g("PC", { subunitId: "pl6" })] }, req("pc", ["PC"]))).toBe(false);
      expect(canDecideRequest(csm, req("pc", ["PC"]))).toBe(true);
      expect(canDecideRequest(oc, req("pc", ["PC"]))).toBe(true);
    });

    it("nobody decides their own, except an ADMIN", () => {
      expect(canDecideRequest(ps, req("ps", ["PS"]))).toBe(false);
      expect(canDecideRequest(oc, req("oc", ["OC"]))).toBe(false);
      const admin = { personId: "ps", grants: [g("PS", { subunitId: "pl6" }), g("ADMIN")] };
      expect(canDecideRequest(admin, req("ps", ["PS", "ADMIN"]))).toBe(true);
      // ADMIN alone still needs a deciding grant over himself
      expect(canDecideRequest({ personId: "t", grants: [g("ADMIN")] }, req("t", ["ADMIN"]))).toBe(false);
    });

    it("OC, 2IC and CSM need no approval; the others are told who approves", () => {
      expect(needsNoApproval([g("2IC")])).toBe(true);
      expect(needsNoApproval([g("PC", { subunitId: "pl6" })])).toBe(false);
      expect(approverOf([])).toBe("your PC or PS");
      expect(approverOf(["PS"])).toBe("your PC, OC, 2IC or CSM");
      expect(approverOf(["PC"])).toBe("OC, 2IC or CSM");
      expect(approverOf(["CSM"])).toBeNull();
    });

    it("the refusal says why", () => {
      expect(decideRefusalText(ps, { ...req("ps", ["PS"]), subunitName: "PLATOON 6" })).toMatch(/your own/);
      expect(decideRefusalText(ps, { ...req("pc", ["PC"]), subunitName: "PLATOON 6" })).toBe("Only OC, 2IC or CSM can decide this.");
      expect(decideRefusalText({ personId: "x" }, { ...req("ps", ["PS"]), subunitName: "PLATOON 6" })).toMatch(/PLATOON 6's PC/);
    });

    it("approved on save can't be undone, only voided", () => {
      const auto = { state: "APPROVED" as const, decidedBy: "m", decidedAt: new Date(), decisionNote: NO_APPROVAL_NOTE };
      expect(undoRefusal(auto, "m", "you")).toMatch(/Void it instead/);
    });
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
    // an event's hours are in its detail, so its line shows just the days
    expect(recordWhat({ ...base, kind: "EVENT", detail: "IPPT @ MAJU 0800-1200H", ...stampRange("2026-08-27", "0800", "2026-08-29", "1200") })).toBe(
      "IPPT @ MAJU 0800-1200H 27/08–29/08",
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
  const rec = { subunitId: "pl6", campId: "sft-a", personId: "p1", ownerRoles: [], state: "PENDING" as const, decidedBy: null, decidedAt: null, decisionNote: null };
  const trooper = { id: "m1", personId: "p1", grants: [] };
  const ps = { id: "m2", personId: "p2", grants: [g("PS", { subunitId: "pl6" })] };
  const stranger = { id: "m3", personId: "p3", grants: [g("GC", { campId: "sft-a" })] };

  it("the trooper sees and withdraws his own pending request; the PS decides it; others see nothing", () => {
    expect(accessTo(trooper, rec, now)).toEqual({ view: true, decide: false, undo: false, sayWhy: false, void: false, withdraw: true });
    expect(accessTo(ps, rec, now)).toEqual({ view: true, decide: true, undo: false, sayWhy: false, void: false, withdraw: false });
    expect(accessTo(stranger, rec, now).view).toBe(false);
  });

  it("a PS sees his own pending request but can't decide it", () => {
    expect(accessTo(ps, { ...rec, personId: "p2", ownerRoles: ["PS"] }, now)).toMatchObject({ view: true, decide: false, withdraw: true });
  });

  it("after a rejection the decider may undo and say why, once", () => {
    const rejected = { ...rec, state: "REJECTED" as const, decidedBy: "m2", decidedAt: new Date(now.getTime() - 1000) };
    expect(accessTo(ps, rejected, now)).toMatchObject({ undo: true, sayWhy: true, void: false, decide: false });
    expect(accessTo(ps, { ...rejected, decisionNote: "short" }, now).sayWhy).toBe(false);
    expect(accessTo(ps, { ...rejected, state: "APPROVED" }, now)).toMatchObject({ undo: true, void: true });
  });
});
