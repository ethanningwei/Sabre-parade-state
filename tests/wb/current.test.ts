// What My records and Person history show by default: what's still current.
import { describe, expect, it } from "vitest";
import { awaitsOutcome, isCurrent, liveChildren, nestOutcomes, REJECTED_SHOWN_MS, type CurrentRow } from "@/lib/wb/domain/rules";

const NOW = new Date("2026-10-12T04:00:00Z"); // 12/10 1200 SGT
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const row = (patch: Partial<CurrentRow>): CurrentRow => ({
  kind: "AL",
  state: "APPROVED",
  endAt: at(3),
  decidedAt: at(-1),
  outcomeAt: null,
  onens: "NA",
  ...patch,
});

describe("isCurrent", () => {
  it.each<[string, Partial<CurrentRow>, boolean]>([
    ["pending, dates ahead", { state: "PENDING", decidedAt: null }, true],
    ["pending, dates already passed (still waiting on a commander)", { state: "PENDING", decidedAt: null, endAt: at(-2) }, true],
    ["approved, not over", { state: "APPROVED" }, true],
    ["approved, ends right now (half-open: over)", { state: "APPROVED", endAt: NOW }, false],
    ["approved, over", { state: "APPROVED", endAt: at(-1) }, false],
    ["recorded event, not over", { kind: "EVENT", state: "RECORDED" }, true],
    ["recorded, open-ended (a permanent status)", { kind: "STATUS", state: "RECORDED", endAt: null }, true],
    ["withdrawn, dates ahead", { state: "WITHDRAWN" }, false],
    ["voided, dates ahead", { state: "CANCELLED" }, false],
    ["rejected yesterday, dates ahead", { state: "REJECTED", decidedAt: at(-1) }, true],
    ["rejected just under a week ago", { state: "REJECTED", decidedAt: new Date(NOW.getTime() - REJECTED_SHOWN_MS + 1000) }, true],
    ["rejected a week ago to the minute", { state: "REJECTED", decidedAt: new Date(NOW.getTime() - REJECTED_SHOWN_MS) }, false],
    ["rejected yesterday, but its dates have passed", { state: "REJECTED", decidedAt: at(-1), endAt: at(-0.5) }, false],
    ["MC over, ONENS still owed", { kind: "MC", state: "RECORDED", endAt: at(-3), onens: "OWED" }, true],
    ["MC over, ONENS done", { kind: "MC", state: "RECORDED", endAt: at(-3), onens: "DONE" }, false],
    ["voided MC that owed ONENS", { kind: "MC", state: "CANCELLED", endAt: at(-3), onens: "OWED" }, false],
  ])("%s → %s", (_tag, patch, want) => {
    expect(isCurrent(row(patch), [], NOW)).toBe(want);
  });

  it("a report sick that's over but has a running MC under it stays", () => {
    const rso = row({ kind: "RSO", endAt: at(-1), outcomeAt: at(-1) });
    expect(isCurrent(rso, [row({ kind: "MC", state: "RECORDED", endAt: at(2) })], NOW)).toBe(true);
    expect(isCurrent(rso, [row({ kind: "MC", state: "RECORDED", endAt: at(-0.5) })], NOW)).toBe(false);
  });

  it("a report sick whose finished MC still owes ONENS stays", () => {
    const rso = row({ kind: "RSO", endAt: at(-5), outcomeAt: at(-5) });
    expect(isCurrent(rso, [row({ kind: "MC", state: "RECORDED", endAt: at(-2), onens: "OWED" })], NOW)).toBe(true);
  });

  it("a status doesn't keep its report sick current: it's in the Statuses panel", () => {
    const rsi = row({ kind: "RSI", endAt: at(-30), outcomeAt: at(-30) });
    expect(isCurrent(rsi, [row({ kind: "STATUS", state: "RECORDED", endAt: null })], NOW)).toBe(false);
    expect(isCurrent(rsi, [row({ kind: "STATUS", state: "RECORDED", endAt: null }), row({ kind: "MC", state: "RECORDED", endAt: at(2) })], NOW)).toBe(true);
  });

  it("a visit with nothing recorded yet stays until he answers; 'nothing given' ends it", () => {
    expect(isCurrent(row({ kind: "RSO", endAt: at(-4) }), [], NOW)).toBe(true);
    expect(isCurrent(row({ kind: "MA", state: "RECORDED", endAt: at(-4) }), [], NOW)).toBe(true);
    expect(isCurrent(row({ kind: "MA", state: "RECORDED", endAt: at(-4), outcomeAt: at(-4) }), [], NOW)).toBe(false);
  });

  it("an over visit whose outcome was all corrected away has nothing live to keep it", () => {
    const rsi = row({ kind: "RSI", endAt: at(-10), outcomeAt: at(-10) });
    expect(isCurrent(rsi, [row({ kind: "STATUS", state: "CANCELLED", endAt: null })], NOW)).toBe(false);
  });
});

describe("awaitsOutcome", () => {
  it.each<[string, Partial<CurrentRow>, CurrentRow[], boolean]>([
    ["approved RSO, nothing yet", { kind: "RSO" }, [], true],
    ["approved RSI, nothing yet", { kind: "RSI" }, [], true],
    ["pending RSO (not approved yet)", { kind: "RSO", state: "PENDING" }, [], false],
    ["rejected RSO", { kind: "RSO", state: "REJECTED" }, [], false],
    ["recorded MA, nothing yet", { kind: "MA", state: "RECORDED" }, [], true],
    ["voided MA", { kind: "MA", state: "CANCELLED" }, [], false],
    ["RSO with an MC", { kind: "RSO" }, [row({ kind: "MC", state: "RECORDED" })], false],
    ["RSO whose only outcome was corrected away", { kind: "RSO" }, [row({ kind: "MC", state: "CANCELLED" })], true],
    ["RSO answered 'nothing given'", { kind: "RSO", outcomeAt: at(-1) }, [], false],
    ["leave", { kind: "AL" }, [], false],
  ])("%s → %s", (_tag, patch, kids, want) => {
    expect(awaitsOutcome(row(patch), kids)).toBe(want);
  });
});

describe("nestOutcomes", () => {
  type R = { id: string; parentId: string | null; state: CurrentRow["state"]; decisionNote: string | null };
  const r = (id: string, parentId: string | null, state: R["state"] = "RECORDED", decisionNote: string | null = null): R => ({ id, parentId, state, decisionNote });

  it("puts live outcomes under their visit, drops dead ones and corrected heads, keeps order", () => {
    const all = [r("al", null, "APPROVED"), r("rso", null, "APPROVED"), r("mc", "rso"), r("old", "rso", "CANCELLED", "Corrected by X"), r("head", null, "CANCELLED", "Corrected by X"), r("st", "head", "CANCELLED")];
    const { top, under } = nestOutcomes(all);
    expect(top.map((x) => x.id)).toEqual(["al", "rso"]);
    expect(under.get("rso")?.map((x) => x.id)).toEqual(["mc"]);
    expect(under.has("head")).toBe(false);
  });

  it("an outcome whose visit isn't in the list shows on its own", () => {
    expect(nestOutcomes([r("mc", "elsewhere")]).top.map((x) => x.id)).toEqual(["mc"]);
  });

  it("liveChildren maps each parent to its live children", () => {
    const m = liveChildren([r("rso", null), r("mc", "rso"), r("old", "rso", "CANCELLED")]);
    expect(m.get("rso")?.map((x) => x.id)).toEqual(["mc"]);
  });
});
