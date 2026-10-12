import { describe, expect, it } from "vitest";
import {
  activeAt,
  addDays,
  checkRange,
  dateRange,
  dayCount,
  daysTouched,
  overlaps,
  rangeLabel,
  stampRange,
  todaySgt,
  touchesDay,
} from "@/lib/wb/domain/timeline";

const sgt = (iso: string) => new Date(`${iso}+08:00`);

describe("timeline: ranges in SGT", () => {
  it("a date range is whole SGT days, half-open", () => {
    const r = dateRange("2026-08-27", "2026-08-29");
    expect(r.startAt.toISOString()).toBe("2026-08-26T16:00:00.000Z");
    expect(r.endAt!.toISOString()).toBe("2026-08-29T16:00:00.000Z"); // 30/08 00:00 SGT
  });

  it("2359 on the end means to the end of the day", () => {
    expect(stampRange("2026-08-27", "2100", "2026-08-29", "2359").endAt).toEqual(dateRange("2026-08-29", "2026-08-29").endAt);
    expect(stampRange("2026-08-27", "0800", "2026-08-27", "1700").endAt).toEqual(sgt("2026-08-27T17:00:00"));
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("today is the SGT date, not the UTC one", () => {
    expect(todaySgt(new Date("2026-08-26T17:00:00Z"))).toBe("2026-08-27"); // 01:00 SGT
  });
});

describe("timeline: overlaps and touches", () => {
  // Sabre Bot checks.py "A day is a day, not noon", on 01/09/26
  it.each([
    ["an afternoon half-day", stampRange("2026-09-01", "1300", "2026-09-01", "2359"), true],
    ["a morning half-day", stampRange("2026-09-01", "0000", "2026-09-01", "0800"), true],
    ["overnight, into today", stampRange("2026-08-31", "2100", "2026-09-01", "0600"), true],
    ["tomorrow", dateRange("2026-09-02", "2026-09-02"), false],
    ["a plain date", dateRange("2026-09-01", "2026-09-01"), true],
  ])("%s", (_tag, r, want) => {
    expect(touchesDay(r, "2026-09-01")).toBe(want);
  });

  it("ends are open: back-to-back ranges don't overlap", () => {
    expect(overlaps(dateRange("2026-08-27", "2026-08-28"), dateRange("2026-08-29", "2026-08-30"))).toBe(false);
    expect(overlaps(dateRange("2026-08-27", "2026-08-29"), dateRange("2026-08-29", "2026-08-30"))).toBe(true);
    // ends at midnight going into the 29th: doesn't touch the 29th
    expect(touchesDay(stampRange("2026-08-28", "2100", "2026-08-28", "2359"), "2026-08-29")).toBe(false);
  });

  it("across midnight in SGT, which is the previous day in UTC", () => {
    const night = stampRange("2026-08-31", "2300", "2026-09-01", "0100");
    expect(touchesDay(night, "2026-08-31")).toBe(true);
    expect(touchesDay(night, "2026-09-01")).toBe(true);
    expect(touchesDay(night, "2026-09-02")).toBe(false);
  });

  it("an open end runs forever", () => {
    const open = { startAt: sgt("2026-08-27T00:00:00"), endAt: null };
    expect(overlaps(open, dateRange("2030-01-01", "2030-01-01"))).toBe(true);
    expect(overlaps(open, dateRange("2026-08-26", "2026-08-26"))).toBe(false);
  });

  it("activeAt includes the start and excludes the end", () => {
    const r = dateRange("2026-08-27", "2026-08-27");
    expect(activeAt(r, sgt("2026-08-27T00:00:00"))).toBe(true);
    expect(activeAt(r, sgt("2026-08-27T23:59:59"))).toBe(true);
    expect(activeAt(r, sgt("2026-08-28T00:00:00"))).toBe(false);
  });
});

describe("timeline: days", () => {
  it("lists every day touched, start time and end time notwithstanding", () => {
    expect(daysTouched(stampRange("2026-08-27", "2100", "2026-08-29", "2359"))).toEqual(["2026-08-27", "2026-08-28", "2026-08-29"]);
    expect(daysTouched(stampRange("2026-08-27", "2100", "2026-08-28", "0600"))).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("is capped at 31 days; dayCount isn't", () => {
    const year = dateRange("2026-01-01", "2026-12-31");
    expect(daysTouched(year)).toHaveLength(31);
    expect(dayCount(year)).toBe(365);
    expect(dayCount(dateRange("2026-08-27", "2026-08-27"))).toBe(1);
  });
});

describe("timeline: labels", () => {
  it.each([
    [dateRange("2026-08-27", "2026-08-29"), "27/08–29/08"],
    [dateRange("2026-08-27", "2026-08-27"), "27/08"],
    [stampRange("2026-08-27", "2100", "2026-08-29", "2359"), "27/08 2100–29/08"],
    [stampRange("2026-08-27", "0800", "2026-08-27", "1700"), "27/08 0800–1700"],
    [stampRange("2026-08-27", "0000", "2026-08-29", "0600"), "27/08–29/08 0600"],
    [{ startAt: sgt("2026-08-27T00:00:00"), endAt: null }, "from 27/08"],
  ])("%#: %s", (r, want) => {
    expect(rangeLabel(r)).toBe(want);
  });
});

describe("timeline: checkRange", () => {
  const ok = { startDate: "2026-08-27", startTime: "0000", endDate: "2026-08-29", endTime: "2359" };
  it("allows today, refuses the past and backwards ranges", () => {
    expect(checkRange(ok, "2026-08-27").ok).toBe(true);
    expect(checkRange(ok, "2026-08-28")).toMatchObject({ ok: false, error: expect.stringMatching(/past/) });
    expect(checkRange({ ...ok, endDate: "2026-08-26" }, "2026-08-20")).toMatchObject({ ok: false, error: "The end can't be before the start." });
    expect(checkRange({ ...ok, endDate: "2026-08-27", startTime: "1700", endTime: "0800" }, "2026-08-20")).toMatchObject({
      ok: false,
      error: "The end has to be after the start.",
    });
  });
});
