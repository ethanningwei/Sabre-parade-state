// What the Mini App's forms send, checked and turned into what a Write takes
// (lib/wb/input.ts): pure, no session and no database.

import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/wb/domain/timeline";
import { dutyRangeFrom, eventFrom, leaveFrom, maFrom, offFrom, sickFrom } from "@/lib/wb/input";

const TODAY = "2026-10-21";
const day = (n: number) => addDays(TODAY, n);

const al = (over: Record<string, unknown> = {}) => ({
  kind: "AL" as const,
  startDate: day(10),
  startTime: "2100",
  endDate: day(12),
  endTime: "2359",
  days: [day(10), day(11), day(12)],
  place: "JOHOR BAHRU",
  reason: "Holiday" as const,
  ...over,
});

describe("leave", () => {
  it("AL: the days ticked are what it costs, and where it is", () => {
    expect(leaveFrom(al(), 14, TODAY)).toMatchObject({ kind: "AL", leaveDays: 3, absent: true, detail: "AL @ JOHOR BAHRU", location: "JOHOR BAHRU", reason: "Holiday" });
    // unticking a day costs less
    expect(leaveFrom(al({ days: [day(10), day(11)] }), 2, TODAY)).toMatchObject({ leaveDays: 2 });
  });

  it("refuses past dates, days outside the range, AL beyond JB, and more than he has", () => {
    expect(() => leaveFrom(al({ startDate: day(-1) }), 14, TODAY)).toThrow(/past/);
    expect(() => leaveFrom(al({ days: [day(10), day(13)] }), 14, TODAY)).toThrow(/aren't all in the range/);
    expect(() => leaveFrom(al({ place: "BANGKOK" }), 14, TODAY)).toThrow(/overseas leave/);
    expect(() => leaveFrom(al(), 2, TODAY)).toThrow(/^That's 3 days of leave and you have 2 left/);
  });

  it("OL: city and country, and a reason of his own", () => {
    expect(leaveFrom(al({ kind: "OL", place: "", city: "bangkok", country: "thailand", days: [day(10)], reason: "OTHER", reasonOther: "Friend's wedding" }), 14, TODAY)).toMatchObject({
      detail: "OL @ BANGKOK, THAILAND",
      reason: "Friend's wedding",
    });
    expect(() => leaveFrom(al({ kind: "OL", place: "", city: "", country: "thailand" }), 14, TODAY)).toThrow("Say which city and country.");
  });

  it("off is just the dates", () => {
    expect(offFrom({ startDate: day(3), startTime: "0000", endDate: day(3), endTime: "2359" }, TODAY)).toMatchObject({ kind: "OFF", absent: true, detail: "OFF" });
  });
});

describe("report sick, MA and events", () => {
  const sick = (over: Record<string, unknown> = {}) => ({ where: "RSO" as const, date: TODAY, clinic: "raffles medical", symptoms: "Fever and sore throat", ...over });

  it("RSO needs a clinic and today or later; RSI is never an absence", () => {
    expect(sickFrom(sick(), TODAY)).toMatchObject({ kind: "RSO", absent: false, location: "RAFFLES MEDICAL", reason: "Fever and sore throat" });
    expect(sickFrom(sick({ where: "RSI", clinic: "" }), TODAY)).toMatchObject({ kind: "RSI", absent: false, location: "" });
    expect(() => sickFrom(sick({ clinic: "" }), TODAY)).toThrow("Say which clinic or hospital.");
    expect(() => sickFrom(sick({ date: day(-1) }), TODAY)).toThrow("That day is over. Tell your PS instead.");
  });

  it("an MA: its time and place, not in the past", () => {
    expect(maFrom({ date: day(2), time: "15:30", place: "national skin centre" }, TODAY)).toMatchObject({ kind: "MA", maTiming: "1530", location: "NATIONAL SKIN CENTRE", absent: true });
    expect(() => maFrom({ date: day(-1), time: "1530", place: "x" }, TODAY)).toThrow(/in the past/);
  });

  it("an event must end after it starts on a single day", () => {
    expect(eventFrom({ what: "IPPT", place: "Maju camp", startDate: day(4), endDate: day(4), timeStart: "0800", timeEnd: "1200" }, TODAY)).toMatchObject({
      kind: "EVENT",
      detail: "IPPT @ MAJU CAMP 0800-1200H",
    });
    expect(() => eventFrom({ what: "X", place: "Y", startDate: day(4), endDate: day(4), timeStart: "1700", timeEnd: "0800" }, TODAY)).toThrow(/has to end after it starts/);
  });
});

describe("Extra/RF/SOL ranges", () => {
  it("must not have ended, and has a length limit", () => {
    const now = new Date(`${TODAY}T12:00:00+08:00`);
    expect(dutyRangeFrom({ startDate: day(1), startTime: "0800", endDate: day(2), endTime: "0800" }, 31, now).endAt).toEqual(new Date(`${day(2)}T08:00:00+08:00`));
    expect(() => dutyRangeFrom({ startDate: TODAY, startTime: "0000", endDate: TODAY, endTime: "1100" }, 31, now)).toThrow("The end has already passed.");
    expect(() => dutyRangeFrom({ startDate: day(1), startTime: "0800", endDate: day(40), endTime: "0800" }, 31, now)).toThrow(/At most 31 days/);
  });
});
