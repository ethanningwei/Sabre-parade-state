import { describe, expect, it } from "vitest";
import { ordHqLines, ordKeptLine, ordText, ordTodayLines, ordTomorrowLine } from "@/lib/wb/domain/ord";

const tan = { rank: "PTE", name: "TAN AH KOW", campName: "SLR", subunitName: "PLATOON 6" };
const lim = { rank: "LCP", name: "LIM BOON", campName: "SRF A", subunitName: "PLATOON 6" };

describe("ORD words", () => {
  it("the DM, in the user's words, without his camp", () => {
    expect(ordText(tan, "2026-10-17", "2026-10-17")).toBe(
      "OWADIOOOO 🎉\n\nToday's your ORD, PTE TAN AH KOW. Thank you for your service, and all the best from Sabre coy!\n\nYour Sabre account closes tonight; your PS can reopen it if anything's left to settle.",
    );
  });

  it("a day late (a missed round), it says when", () => {
    expect(ordText(tan, "2026-10-15", "2026-10-17")).toContain("Your ORD was on 15/10, PTE TAN AH KOW. Thank you");
  });

  it("digest lines: one man, several, COY HQ, the evening before, kept", () => {
    expect(ordTodayLines([tan])).toBe("🎉 ORD today: PTE TAN AH KOW (SLR). Off the roster tonight.");
    expect(ordTodayLines([tan, lim])).toBe("🎉 2 ORDs today, off the roster tonight\n• PTE TAN AH KOW (SLR)\n• LCP LIM BOON (SRF A)");
    expect(ordHqLines([tan])).toBe("🎉 1 ORD today, company-wide\n• PTE TAN AH KOW (SLR · PLATOON 6)");
    expect(ordTomorrowLine(tan)).toBe("🎓 ORD tomorrow: PTE TAN AH KOW (SLR). Off the roster tomorrow evening. Wrong date? He can fix it in Sabre (My details).");
    expect(ordKeptLine(tan, "bootstrap")).toMatch(/^🎓 ORD today but kept: PTE TAN AH KOW is in WB_ADMIN_TELEGRAM_IDS/);
    expect(ordKeptLine(tan, "last-admin")).toMatch(/is the last Sabre admin/);
  });
});
