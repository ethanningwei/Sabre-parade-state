import { describe, expect, it } from "vitest";
import { sgtToInstant } from "@/lib/parade/time";
import { STAYOUT_CALLBACK } from "@/lib/wb/domain/projection-kinds";
import { WEEKDAYS, type ShiftPattern } from "@/lib/wb/domain/shifts";
import { campOnAt, nightOver, onStayout, stayoutLabel, stayoutMessage, stayoutNight, type StayoutMan } from "@/lib/wb/domain/stayout";

const at = (date: string, time: string) => sgtToInstant({ date, time });

describe("the stay-out night", () => {
  it("runs from 2100 to 0600 SGT, named for the evening it starts", () => {
    expect(stayoutNight(at("2026-10-27", "2059"))).toBeNull();
    expect(stayoutNight(at("2026-10-27", "2100"))).toBe("2026-10-27");
    expect(stayoutNight(at("2026-10-28", "0559"))).toBe("2026-10-27");
    expect(stayoutNight(at("2026-10-28", "0600"))).toBeNull();
    expect(stayoutNight(at("2026-11-01", "0000"))).toBe("2026-10-31");
  });

  it("is over at 0600 the morning after", () => {
    expect(nightOver("2026-10-27", at("2026-10-28", "0559"))).toBe(false);
    expect(nightOver("2026-10-27", at("2026-10-28", "0600"))).toBe(true);
  });

  it("who: permanent, or temporary up to and including its last night", () => {
    expect(onStayout({ stayout: "PERM", stayoutUntil: null }, "2026-10-27")).toBe(true);
    expect(onStayout({ stayout: "TEMP", stayoutUntil: "2026-10-27" }, "2026-10-27")).toBe(true);
    expect(onStayout({ stayout: "TEMP", stayoutUntil: "2026-10-26" }, "2026-10-27")).toBe(false);
    expect(onStayout({ stayout: "NONE", stayoutUntil: "2099-01-01" }, "2026-10-27")).toBe(false);
    expect(stayoutLabel({ stayout: "TEMP", stayoutUntil: "2026-10-31" }, "2026-10-27")).toBe("until 31/10");
    expect(stayoutLabel({ stayout: "TEMP", stayoutUntil: "2026-10-26" }, "2026-10-27")).toBeNull();
    expect(stayoutLabel({ stayout: "PERM", stayoutUntil: null }, "2026-10-27")).toBe("Permanent");
  });

  it("whether his camp is on at 2100: its pattern, else what v1 says", () => {
    const weekly: ShiftPattern = { campId: "rg", kind: "WEEKLY", onDays: 0, offDays: 0, anchorDate: null, hotoTime: "0800", weekdayMask: WEEKDAYS, holidaysOff: false, bothOnAllowed: false };
    const cycle: ShiftPattern = { campId: "sftA", kind: "CYCLE", onDays: 3, offDays: 3, anchorDate: "2026-10-24", hotoTime: "2100", weekdayMask: 0, holidaysOff: false, bothOnAllowed: false };
    // Tuesday on, Saturday off, whatever v1 says now
    expect(campOnAt(weekly, [], false, at("2026-10-27", "2100"))).toBe(true);
    expect(campOnAt(weekly, [], true, at("2026-10-31", "2100"))).toBe(false);
    expect(campOnAt(weekly, [{ on: true, fromAt: at("2026-10-31", "0000"), untilAt: at("2026-11-01", "0000") }], false, at("2026-10-31", "2100"))).toBe(true);
    // the team mounting at 2100 is on; it stood down three days later at 2100
    expect(campOnAt(cycle, [], false, at("2026-10-24", "2100"))).toBe(true);
    expect(campOnAt(cycle, [], true, at("2026-10-27", "2100"))).toBe(false);
    expect(campOnAt(undefined, [], true, at("2026-10-27", "2100"))).toBe(true);
  });
});

describe("the evening message", () => {
  const PL = "11111111-1111-4111-8111-111111111111";
  const man = (n: number, state: StayoutMan["state"] = null): StayoutMan => ({ personId: `00000000-0000-4000-8000-00000000000${n}`, rank: "CPL", name: `TAN ${n}`, campName: "SFT A", state });

  it("lists them, with ✅ Correct and a staying-in button each", () => {
    const m = stayoutMessage({ subunitId: PL, night: "2026-10-27", men: [man(1), man(2)], confirmedBy: null });
    expect(m.text).toMatch(/^🏠 Stay-out tonight 2100–0600 · 2\n/);
    expect(m.text).toContain("• CPL TAN 1 (SFT A)\n• CPL TAN 2 (SFT A)");
    expect(m.buttons.map((r) => r[0].text)).toEqual(["✅ Correct", "🛏 CPL TAN 1 staying in", "🛏 CPL TAN 2 staying in"]);
    for (const [b] of m.buttons) {
      expect(b.data).toMatch(STAYOUT_CALLBACK);
      expect(new TextEncoder().encode(b.data).length).toBeLessThanOrEqual(64);
    }
    expect(m.buttons[0][0].data).toBe(`y:${PL}:2026-10-27:ok`);
  });

  it("one staying in: not counted, and his button takes it back", () => {
    const m = stayoutMessage({ subunitId: PL, night: "2026-10-27", men: [man(1, "STAYING_IN"), man(2)], confirmedBy: null });
    expect(m.text).toMatch(/· 1\n/);
    expect(m.text).toContain("• CPL TAN 1 (SFT A) · 🛏 staying in");
    expect(m.buttons[1][0].text).toBe("🏠 CPL TAN 1 stays out");
  });

  it("confirmed: says by whom, and ✅ Correct goes", () => {
    const m = stayoutMessage({ subunitId: PL, night: "2026-10-27", men: [man(1, "CONFIRMED"), man(2, "STAYING_IN")], confirmedBy: "3SG LIM" });
    expect(m.text).toMatch(/✅ Confirmed by 3SG LIM$/);
    expect(m.buttons.map((r) => r[0].text)).toEqual(["🛏 CPL TAN 1 staying in", "🏠 CPL TAN 2 stays out"]);
  });
});
