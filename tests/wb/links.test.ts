import { describe, expect, it } from "vitest";
import { miniAppLink, miniAppUrl, routeToStartParam, startParamToPath } from "@/lib/wb/telegram/links";

describe("Mini App deep links", () => {
  it("encodes routes into start_param and back", () => {
    expect(routeToStartParam("admin/grants")).toBe("admin__grants");
    expect(routeToStartParam("/tg/gaps")).toBe("gaps");
    expect(routeToStartParam("")).toBe("");
    expect(startParamToPath("admin__grants")).toBe("/tg/admin/grants");
    expect(startParamToPath("gaps")).toBe("/tg/gaps");
  });

  it("refuses anything that isn't a plain route", () => {
    expect(routeToStartParam("../etc")).toBeNull();
    expect(routeToStartParam("a?b=c")).toBeNull();
    expect(startParamToPath(null)).toBe("/tg");
    expect(startParamToPath("//evil.com")).toBe("/tg");
    expect(startParamToPath("a/b")).toBe("/tg");
    expect(startParamToPath("UPPER")).toBe("/tg");
  });

  it("builds t.me and web_app URLs", () => {
    expect(miniAppLink("@sabrecoybot")).toBe("https://t.me/sabrecoybot/app");
    expect(miniAppLink("sabrecoybot", "admin/grants")).toBe("https://t.me/sabrecoybot/app?startapp=admin__grants");
    expect(miniAppUrl("https://x.vercel.app/")).toBe("https://x.vercel.app/tg");
    expect(miniAppUrl("https://x.vercel.app", "gaps")).toBe("https://x.vercel.app/tg/gaps");
  });
});
