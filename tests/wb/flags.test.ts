// With FEATURE_* off the app must be exactly v1: every whereabouts entry point
// is a 404. Route handlers are called directly, as Next would call them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as auth } from "@/app/api/wb/auth/route";
import { POST as setup } from "@/app/api/wb/setup/route";
import { POST as telegram } from "@/app/api/wb/telegram/route";
import { featureOff, isEnabled, requireFeature } from "@/lib/flags";

afterEach(() => vi.unstubAllEnvs());

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers, body: "{}" });

describe("feature flags", () => {
  it("are off unless set to exactly 1", () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    expect(isEnabled("WHEREABOUTS")).toBe(false);
    vi.stubEnv("FEATURE_WHEREABOUTS", "true");
    expect(isEnabled("WHEREABOUTS")).toBe(false);
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    expect(isEnabled("WHEREABOUTS")).toBe(true);
    expect(isEnabled("PROJECTION")).toBe(false);
    expect(isEnabled("CLAIMS")).toBe(false);
  });

  it("requireFeature 404s pages and server actions when off", () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "0");
    expect(() => requireFeature()).toThrow(expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    expect(() => requireFeature()).not.toThrow();
    expect(featureOff()).toBeNull();
  });

  it("every /api/wb route handler is a 404 when off, even with valid-looking secrets", async () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "");
    vi.stubEnv("WB_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("WB_BOT_TOKEN", "123:abc");
    for (const res of [
      await auth(post("/api/wb/auth")),
      await telegram(post("/api/wb/telegram", { "x-telegram-bot-api-secret-token": "s3cret" })),
      await setup(post("/api/wb/setup?action=status", { authorization: "Bearer s3cret" })),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("when on, the webhook and setup refuse a wrong secret", async () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    vi.stubEnv("WB_WEBHOOK_SECRET", "s3cret");
    expect((await telegram(post("/api/wb/telegram", { "x-telegram-bot-api-secret-token": "nope" }))).status).toBe(401);
    expect((await telegram(post("/api/wb/telegram"))).status).toBe(401);
    expect((await setup(post("/api/wb/setup", { authorization: "Bearer nope" }))).status).toBe(403);
    vi.stubEnv("WB_WEBHOOK_SECRET", "");
    expect((await telegram(post("/api/wb/telegram", { "x-telegram-bot-api-secret-token": "" }))).status).toBe(401);
  });

  it("when on, auth refuses initData that isn't Telegram's", async () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    vi.stubEnv("WB_BOT_TOKEN", "123:abc");
    const res = await auth(new Request("http://localhost/api/wb/auth", { method: "POST", body: JSON.stringify({ initData: "user=x&hash=00" }) }));
    expect(res.status).toBe(401);
  });
});
