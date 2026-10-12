// Phase 3's pure rules: report sick, outcomes, ONENS, void cascade, who may
// read a diagnosis, and how a medical record reads on a card.
import { describe, expect, it } from "vitest";
import { recordWhat } from "@/lib/wb/domain/describe";
import type { GrantRow } from "@/lib/wb/domain/grants";
import {
  asksSeenBy,
  canSeeMedical,
  initialState,
  isAbsentKind,
  kinOf,
  needsApproval,
  onensFor,
  outcomeParentRefusal,
  type WbRecordKind,
  type WbRecordState,
} from "@/lib/wb/domain/rules";
import { dateRange, dayRange } from "@/lib/wb/domain/timeline";

const g = (role: GrantRow["role"], scope: Partial<GrantRow> = {}): GrantRow => ({ role, subunitId: null, campId: null, ...scope });

describe("report sick", () => {
  it("RSI and RSO wait for a PC/PS, like leave", () => {
    expect(needsApproval("RSI")).toBe(true);
    expect(needsApproval("RSO")).toBe(true);
    expect(initialState("RSO")).toBe("PENDING");
  });

  it.each<[WbRecordKind, boolean]>([
    ["RSI", false],
    ["RSO", true],
    ["MC", true],
    ["HL", true],
    ["STATUS", false],
  ])("%s absent → %s", (kind, absent) => {
    expect(isAbsentKind(kind)).toBe(absent);
  });

  it("outcomes are recorded, never approved", () => {
    for (const k of ["MC", "HL", "STATUS"] as const) expect(initialState(k)).toBe("RECORDED");
  });
});

describe("outcome parent", () => {
  const p = (kind: WbRecordKind, state: WbRecordState, personId = "me") => ({ kind, state, personId });
  it.each<[string, ReturnType<typeof p>, string | null]>([
    ["approved RSO", p("RSO", "APPROVED"), null],
    ["approved RSI", p("RSI", "APPROVED"), null],
    ["recorded MA", p("MA", "RECORDED"), null],
    ["pending RSO", p("RSO", "PENDING"), "Your commander hasn't approved this report sick yet."],
    ["rejected RSI", p("RSI", "REJECTED"), "That report sick wasn't approved, so there's no outcome to record."],
    ["voided MA", p("MA", "CANCELLED"), "That report sick wasn't approved, so there's no outcome to record."],
    ["leave", p("AL", "APPROVED"), "An outcome goes on a report sick or a medical appointment."],
    ["someone else's", p("RSO", "APPROVED", "him"), "That isn't yours."],
  ])("%s", (_t, parent, want) => {
    expect(outcomeParentRefusal(parent, "me")).toBe(want);
  });
});

describe("ONENS", () => {
  it.each<[string, WbRecordKind, WbRecordKind | null, "MO" | "CIVILIAN" | null, boolean, string]>([
    ["MC after an RSO: civilian", "MC", "RSO", null, false, "OWED"],
    ["MC after an RSO, already uploaded", "MC", "RSO", null, true, "DONE"],
    ["HL after an RSO", "HL", "RSO", null, false, "OWED"],
    ["MC after an RSI: the MO's", "MC", "RSI", null, false, "NA"],
    ["standalone MC, civilian", "MC", null, "CIVILIAN", false, "OWED"],
    ["standalone MC, MO", "MC", null, "MO", false, "NA"],
    ["MC after an MA at a civilian hospital", "MC", "MA", "CIVILIAN", false, "OWED"],
    ["a status is never owed", "STATUS", "RSO", null, false, "NA"],
  ])("%s → %s", (_t, kind, parent, seen, uploaded, want) => {
    expect(onensFor(kind, parent, seen, uploaded)).toBe(want);
  });

  it("asks who he saw only when no report sick says so", () => {
    expect(asksSeenBy(null)).toBe(true);
    expect(asksSeenBy("MA")).toBe(true);
    expect(asksSeenBy("RSO")).toBe(false);
    expect(asksSeenBy("RSI")).toBe(false);
  });
});

describe("void cascade (Sabre Bot's _void_kin)", () => {
  const r = (id: string, parentId: string | null, state: WbRecordState = "RECORDED") => ({ id, parentId, state });
  it("takes the record and its live children, not grandchildren or dead ones", () => {
    const head = r("rso", null, "APPROVED");
    const rows = [head, r("mc", "rso"), r("st", "rso"), r("old", "rso", "CANCELLED"), r("other", null), r("grand", "mc")];
    expect(kinOf(head, rows).map((x) => x.id)).toEqual(["rso", "mc", "st"]);
  });
});

describe("who may read a diagnosis", () => {
  const rec = { personId: "trooper", subunitId: "pl6", campId: "slr" };
  it.each<[string, { personId: string | null; grants: GrantRow[] }, boolean]>([
    ["the trooper", { personId: "trooper", grants: [] }, true],
    ["his PS", { personId: "ps", grants: [g("PS", { subunitId: "pl6" })] }, true],
    ["his PC", { personId: null, grants: [g("PC", { subunitId: "pl6" })] }, true],
    ["OC", { personId: null, grants: [g("OC")] }, true],
    ["2IC", { personId: null, grants: [g("2IC")] }, true],
    ["CSM", { personId: null, grants: [g("CSM")] }, true],
    ["another platoon's PS", { personId: null, grants: [g("PS", { subunitId: "pl5" })] }, false],
    ["his camp's GC", { personId: null, grants: [g("GC", { campId: "slr" })] }, false],
    ["an ASA", { personId: null, grants: [g("ASA")] }, false],
    ["an admin", { personId: null, grants: [g("ADMIN")] }, false],
    ["someone not on the roster", { personId: null, grants: [] }, false],
  ])("%s → %s", (_t, viewer, want) => {
    expect(canSeeMedical(viewer, rec)).toBe(want);
  });
});

describe("how medical records read (safe for a group chat)", () => {
  const base = { detail: "", location: "", maTiming: null, mcCategory: null };
  it("report sick", () => {
    expect(recordWhat({ ...base, kind: "RSI", ...dayRange("2026-10-14") })).toBe("RSI 14/10");
    expect(recordWhat({ ...base, kind: "RSO", location: "RAFFLES MEDICAL", ...dayRange("2026-10-14") })).toBe("RSO 14/10 @ RAFFLES MEDICAL");
  });
  it("MC: days and category, never the diagnosis", () => {
    expect(recordWhat({ ...base, kind: "MC", mcCategory: "Respiratory", ...dateRange("2026-10-14", "2026-10-16") })).toBe("MC 3 days · 14/10–16/10 · Respiratory");
    expect(recordWhat({ ...base, kind: "HL", mcCategory: "Other", ...dayRange("2026-10-14") })).toBe("HL 1 day · 14/10 · Other");
  });
  it("statuses, temporary and permanent", () => {
    expect(recordWhat({ ...base, kind: "STATUS", detail: "LIGHT DUTY", ...dateRange("2026-10-17", "2026-10-20") })).toBe("LIGHT DUTY 17/10–20/10");
    expect(recordWhat({ ...base, kind: "STATUS", detail: "EXCUSE RMJ", startAt: dayRange("2026-10-17").startAt, endAt: null })).toBe(
      "EXCUSE RMJ from 17/10 (permanent)",
    );
  });
});
