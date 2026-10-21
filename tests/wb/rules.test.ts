import { describe, expect, it } from "vitest";
import { clashLines, type ClashDuty, type ClashRecord } from "@/lib/wb/domain/clash";
import { eventDetail, overseasWhere, recordLine, recordWhat } from "@/lib/wb/domain/describe";
import { holidayOn } from "@/lib/wb/domain/holidays";
import {
  initialState,
  leaveChange,
  leaveRefusal,
  nextState,
  NO_APPROVAL_NOTE,
  undoRefusal,
  UNDO_WINDOW_MS,
  WB_RECORD_STATES,
  type RecordAction,
} from "@/lib/wb/domain/rules";
import { dateRange, stampRange } from "@/lib/wb/domain/timeline";

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

  it("approved on save can't be undone, only voided", () => {
    const auto = { state: "APPROVED" as const, decidedBy: "m", decidedAt: new Date(), decisionNote: NO_APPROVAL_NOTE };
    expect(undoRefusal(auto, "m", "you")).toMatch(/Void it instead/);
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

