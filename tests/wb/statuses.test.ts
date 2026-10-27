import { describe, expect, it } from "vitest";
import { statusesOf, type StatusRow } from "@/lib/wb/domain/statuses";
import { dateRange } from "@/lib/wb/domain/timeline";

const now = new Date("2026-10-27T10:00:00+08:00");

let n = 0;
function row(over: Partial<StatusRow> & { days?: [string, string]; since?: string }): StatusRow {
  const { days, since, ...rest } = over;
  const r = days ? dateRange(days[0], days[1]) : { startAt: dateRange(since ?? "2026-09-01", since ?? "2026-09-01").startAt, endAt: null };
  return { id: `r${++n}`, parentId: null, kind: "STATUS", state: "RECORDED", detail: "LIGHT DUTY", createdVia: "SELF", decisionNote: null, ...r, ...rest };
}

describe("statusesOf", () => {
  it("permanent first, oldest first; then temporary, soonest to end", () => {
    const rows = [
      row({ id: "t-late", days: ["2026-10-20", "2026-11-03"] }),
      row({ id: "p-new", since: "2026-09-01" }),
      row({ id: "t-soon", days: ["2026-10-25", "2026-10-28"] }),
      row({ id: "p-old", since: "2025-03-12" }),
    ];
    expect(statusesOf(rows, now).live.map((s) => s.id)).toEqual(["p-old", "p-new", "t-soon", "t-late"]);
  });

  it("dates, days left and ending soon", () => {
    const { live } = statusesOf(
      [
        row({ id: "perm", since: "2025-03-12" }),
        row({ id: "week", days: ["2026-10-20", "2026-11-03"] }),
        row({ id: "today", days: ["2026-10-25", "2026-10-27"] }),
        row({ id: "tomorrow", days: ["2026-10-25", "2026-10-28"] }),
        row({ id: "after", days: ["2026-10-25", "2026-10-29"] }),
        row({ id: "later", days: ["2026-11-01", "2026-11-05"] }),
      ],
      now,
    );
    const by = new Map(live.map((s) => [s.id, s]));
    expect(by.get("perm")).toMatchObject({ permanent: true, from: "2025-03-12", until: null, daysLeft: null, endsSoon: false });
    expect(by.get("week")).toMatchObject({ permanent: false, from: "2026-10-20", until: "2026-11-03", daysLeft: 7, endsSoon: false, upcoming: false });
    expect(by.get("today")).toMatchObject({ daysLeft: 0, endsSoon: true });
    expect(by.get("tomorrow")).toMatchObject({ daysLeft: 1, endsSoon: true });
    expect(by.get("after")).toMatchObject({ daysLeft: 2, endsSoon: false });
    expect(by.get("later")).toMatchObject({ upcoming: true });
  });

  it("ended and voided are past, newest first; a corrected row and other kinds are left out", () => {
    const { live, past } = statusesOf(
      [
        row({ id: "voided", state: "CANCELLED", decisionNote: "Voided by 2LT LIM", days: ["2026-10-20", "2026-11-03"] }),
        row({ id: "corrected", state: "CANCELLED", decisionNote: "Corrected by PTE IRFAN", days: ["2026-10-15", "2026-11-03"] }),
        row({ id: "ended", days: ["2026-10-01", "2026-10-10"] }),
        row({ id: "mc", kind: "MC", days: ["2026-10-26", "2026-10-28"] }),
        row({ id: "rejected", state: "REJECTED", days: ["2026-10-26", "2026-10-28"] }),
      ],
      now,
    );
    expect(live).toEqual([]);
    expect(past.map((s) => [s.id, s.voided, s.endsSoon])).toEqual([
      ["voided", true, false],
      ["ended", false, false],
    ]);
  });

  it("says where each came from", () => {
    const rsi = row({ id: "rsi", kind: "RSI", state: "APPROVED", days: ["2026-10-20", "2026-10-20"] });
    const ma = row({ id: "ma", kind: "MA", days: ["2026-10-22", "2026-10-22"] });
    const mc = row({ id: "mc", kind: "MC", days: ["2026-10-24", "2026-10-26"] });
    const { live } = statusesOf(
      [
        rsi,
        ma,
        mc,
        row({ id: "of-rsi", parentId: "rsi", days: ["2026-10-20", "2026-11-03"] }),
        row({ id: "of-ma", parentId: "ma", days: ["2026-10-22", "2026-11-03"] }),
        row({ id: "declared", createdVia: "DECLARED" }),
        row({ id: "head", days: ["2026-10-25", "2026-11-03"] }),
        row({ id: "sibling", parentId: "head", days: ["2026-10-25", "2026-11-03"] }),
        row({ id: "of-mc", parentId: "mc", days: ["2026-10-24", "2026-11-03"] }),
      ],
      now,
    );
    expect(Object.fromEntries(live.map((s) => [s.id, s.source]))).toEqual({
      "of-rsi": "From RSI 20/10",
      "of-ma": "From MA 22/10",
      declared: "Declared by him",
      head: "Recorded by him",
      sibling: "Recorded by him",
      "of-mc": "Recorded by him",
    });
  });
});
