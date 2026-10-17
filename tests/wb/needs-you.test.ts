import { describe, expect, it } from "vitest";
import type { GridCell, GridRow } from "@/lib/wb/domain/forecast";
import { needsYou, type NeedsYouInput } from "@/lib/wb/domain/needs-you";

const TODAY = "2026-10-16";
const TOMORROW = "2026-10-17";
const NOW = new Date("2026-10-16T09:00:00+08:00");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const cell = (date: string, over: Partial<GridCell> = {}): GridCell => ({ date, on: true, label: "1:6:1", short: false, pendingShort: false, pendingLabel: null, ...over });
const row = (campName: string, today: Partial<GridCell> = {}, tomorrow: Partial<GridCell> = {}): GridRow => ({
  campId: campName,
  campName,
  subunitId: "pl6",
  subunitName: "PLATOON 6",
  minimum: null,
  cells: [cell(TODAY, today), cell(TOMORROW, tomorrow)],
});
const run = (over: Partial<NeedsYouInput>) => needsYou({ pending: [], short: [], companyOnly: false, now: NOW, today: TODAY, ...over });

describe("needsYou", () => {
  it("nothing due: no lines, so no card", () => {
    expect(run({ short: [row("SLR"), row("BDK")] })).toEqual([]);
  });

  it("short today and tomorrow: one line, opening the first short day", () => {
    const [line] = run({ short: [row("BDK", { short: true }), row("SLR", {}, { short: true })] });
    expect(line).toEqual({ kind: "short", text: "BDK below minimum today · SLR tomorrow", href: `/tg/manpower?date=${TODAY}` });
  });

  it("only tomorrow: names tomorrow and opens it", () => {
    expect(run({ short: [row("KC3", {}, { short: true })] })[0]).toMatchObject({ text: "KC3 below minimum tomorrow", href: `/tg/manpower?date=${TOMORROW}` });
  });

  it("more than two camps on a day: the first, +N", () => {
    expect(run({ short: [row("BDK", { short: true }), row("KC3", { short: true }), row("SLR", { short: true })] })[0].text).toBe("BDK +2 below minimum today");
    expect(run({ short: [row("BDK", { short: true }), row("KC3", { short: true })] })[0].text).toBe("BDK, KC3 below minimum today");
  });

  it("off shift and short-only-if-pending don't count", () => {
    expect(run({ short: [row("SFT A", { on: false, short: true }), row("SLR", { pendingShort: true })] })).toEqual([]);
  });

  it("requests: starting within 48 h apart from the rest, one line each", () => {
    const pending = [{ startAt: inHours(20), ownerRoles: [] }, { startAt: inHours(-3), ownerRoles: [] }, { startAt: inHours(100), ownerRoles: [] }];
    expect(run({ pending }).map((l) => l.text)).toEqual(["2 urgent requests · starting soon or started", "1 more to approve"]);
    expect(run({ pending: [pending[2], pending[2]] }).map((l) => l.text)).toEqual(["2 requests to approve"]);
    expect(run({ pending: [pending[0]] }).map((l) => l.text)).toEqual(["1 urgent request · starting within 48 hours"]);
  });

  it("an undecided request that has already started says so", () => {
    expect(run({ pending: [{ startAt: inHours(-20), ownerRoles: [] }] })[0].text).toBe("1 urgent request · already started");
  });

  it("OC/2IC/CSM: only what the company decides, plus anything about to start", () => {
    const trooperFar = { startAt: inHours(100), ownerRoles: [] };
    const trooperSoon = { startAt: inHours(24), ownerRoles: [] };
    const pcFar = { startAt: inHours(100), ownerRoles: ["PC" as const] };
    expect(run({ pending: [trooperFar], companyOnly: true })).toEqual([]);
    expect(run({ pending: [trooperFar, trooperSoon, pcFar], companyOnly: true }).map((l) => l.text)).toEqual(["1 urgent request · starting within 48 hours", "1 more to approve"]);
    expect(run({ pending: [trooperFar, pcFar] }).map((l) => l.text)).toEqual(["2 requests to approve"]);
  });

  it("order: short, then soon, then the rest", () => {
    const lines = run({ short: [row("BDK", { short: true })], pending: [{ startAt: inHours(100), ownerRoles: [] }, { startAt: inHours(1), ownerRoles: [] }] });
    expect(lines.map((l) => l.kind)).toEqual(["short", "soon", "approve"]);
    expect(lines.every((l) => l.href.startsWith("/tg/"))).toBe(true);
  });

  it("v1's blocking issues: one line after short, opening v1's Parade screen", () => {
    expect(run({ paradeIssues: 0 })).toEqual([]);
    expect(run({ paradeIssues: 1 })).toEqual([{ kind: "parade", text: "Parade state blocked · 1 issue to fix", href: "/parade" }]);
    const lines = run({ paradeIssues: 3, short: [row("BDK", { short: true })], pending: [{ startAt: inHours(2), ownerRoles: [] }] });
    expect(lines.map((l) => l.kind)).toEqual(["short", "parade", "soon"]);
    expect(lines[1].text).toBe("Parade state blocked · 3 issues to fix");
  });
});
