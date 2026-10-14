import { describe, expect, it } from "vitest";
import { sgtToInstant } from "@/lib/parade/time";
import type { AbsenceValues, Plan, PProjection } from "@/lib/wb/domain/projection";
import { absenceText, formatProjection } from "@/lib/wb/domain/projection-report";

const v = (o: Partial<AbsenceValues>): AbsenceValues => ({
  status: "AL",
  otherReason: "",
  startDate: "2026-10-13",
  startTime: null,
  endDate: "2026-10-15",
  endTime: null,
  maTiming: "",
  maLocation: "",
  ...o,
});
const people = new Map([
  ["p1", { rank: "PTE", name: "TAN", campId: "tft" }],
  ["p2", { rank: "LCP", name: "LIM", campId: "hdn" }],
]);
const camps = new Map([
  ["tft", "TFT"],
  ["hdn", "HDN"],
  ["bdk", "BDK"],
]);
const proj = { id: "x", kind: "ABSENCE" } as PProjection;

describe("projection report", () => {
  it("says what an absence is, as on the parade state", () => {
    expect(absenceText(v({}))).toBe("AL 13/10–15/10");
    expect(absenceText(v({ status: "OFF", startTime: "2100", endDate: "2026-10-14", endTime: "2100" }))).toBe("OFF 13/10 2100–14/10 2100");
    expect(absenceText(v({ status: "MA", endDate: null, maTiming: "1300", maLocation: "KTPH" }))).toBe("MA 13/10 1300H @ KTPH");
    expect(absenceText(v({ status: "OTHERS", otherReason: "COURSE" }))).toBe("COURSE 13/10–15/10");
  });

  it("shadow: per camp in roster order, then shifts and what already agrees; nothing written", () => {
    const plan: Plan = {
      writes: [
        { op: "absence", personId: "p2", recordId: "r2", values: v({ status: "MC" }), replaces: null, why: "open" },
        { op: "duty", personId: "p1", assignmentId: "a1", values: { type: "RF", rank: "", name: "", personId: "p1", campId: "bdk", startDate: "2026-10-13", startTime: "2100", endDate: "2026-10-16", endTime: "2100" }, projection: null, why: "open" },
        { op: "shift", campId: "tft", onShift: false, events: ["e1"] },
      ],
      marks: [],
      notes: [
        { op: "conflict", personId: "p1", recordId: "r1", want: "AL", has: "COURSE" },
        { op: "agrees", personId: "p2", recordId: "r3" },
      ],
    };
    expect(formatProjection({ plan, live: false, people, camps })).toBe(
      [
        "🔍 Shadow diff\n\nProjection is off: this is what it would write to the parade state now. Nothing was written.",
        "TFT\n• PTE TAN: + RF @ BDK 13/10 2100–16/10 2100\n• PTE TAN: ⚠️ the GC has COURSE, the timeline says AL: left as the GC has it",
        "HDN\n• LCP LIM: + MC 13/10–15/10",
        "Shifts (HOTO): TFT off",
        "1 already as the GCs typed them.",
      ].join("\n\n"),
    );
  });

  it("live: counts, failures inline, and an empty plan says so", () => {
    const w = { op: "close-absence" as const, personId: "p1", projection: proj, why: "BACK" as const };
    const text = formatProjection({ plan: { writes: [w], marks: [], notes: [] }, live: true, people, camps, applied: 0, failed: [{ write: w, error: "TFT is off shift." }] });
    expect(text).toContain("🔁 Projection\n\nWritten to the parade state: 0 · not written: 1");
    expect(text).toContain("• PTE TAN: − back, present (Back confirmed) ✖ not written: TFT is off shift.");
    expect(formatProjection({ plan: { writes: [], marks: [], notes: [] }, live: true, people, camps, applied: 0 })).toContain("Nothing to change");
    const due = formatProjection({
      plan: { writes: [], marks: [], notes: [{ op: "due-back", personId: "p2", projection: proj, what: "MC", endedAt: sgtToInstant({ date: "2026-10-14", time: "0900" }) }] },
      live: true,
      people,
      camps,
    });
    expect(due).toContain("• LCP LIM: ⌛ MC ended 14/10 0900, waiting for Back");
  });

  it("stays under Telegram's limit", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ op: "conflict" as const, personId: "p1", recordId: `r${i}`, want: "AL", has: "A LONG REASON TYPED BY A GC" }));
    const text = formatProjection({ plan: { writes: [], marks: [], notes: many }, live: false, people, camps });
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/… and \d+ more \(npm run wb:setup -- diff\)$/);
  });
});
