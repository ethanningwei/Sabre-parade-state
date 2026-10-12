// With FEATURE_* off the app must be exactly v1: every whereabouts entry point
// is a 404. Route handlers are called directly, as Next would call them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as auth } from "@/app/api/wb/auth/route";
import { GET as evening } from "@/app/api/wb/cron/evening/route";
import { GET as file } from "@/app/api/wb/file/[recordId]/route";
import { POST as photo } from "@/app/api/wb/photo/route";
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
    vi.stubEnv("CRON_SECRET", "s3cret");
    for (const res of [
      await auth(post("/api/wb/auth")),
      await telegram(post("/api/wb/telegram", { "x-telegram-bot-api-secret-token": "s3cret" })),
      await setup(post("/api/wb/setup?action=status", { authorization: "Bearer s3cret" })),
      await photo(post("/api/wb/photo")),
      await file(new Request("http://localhost/api/wb/file/x"), { params: Promise.resolve({ recordId: "x" }) }),
      await evening(new Request("http://localhost/api/wb/cron/evening", { headers: { authorization: "Bearer s3cret" } })),
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

  it("when on, the evening round refuses a missing or wrong CRON_SECRET", async () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    const get = (h: Record<string, string>) => evening(new Request("http://localhost/api/wb/cron/evening", { headers: h }));
    vi.stubEnv("CRON_SECRET", "");
    expect((await get({ authorization: "Bearer " })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await get({ authorization: "Bearer nope!" })).status).toBe(401);
    expect((await get({})).status).toBe(401);
  });

  it("when on, auth refuses initData that isn't Telegram's", async () => {
    vi.stubEnv("FEATURE_WHEREABOUTS", "1");
    vi.stubEnv("WB_BOT_TOKEN", "123:abc");
    const res = await auth(new Request("http://localhost/api/wb/auth", { method: "POST", body: JSON.stringify({ initData: "user=x&hash=00" }) }));
    expect(res.status).toBe(401);
  });
});

// A new page or route that forgets the guard would be reachable with the flags off.
describe("every whereabouts entry point is guarded", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const root = join(__dirname, "../..");

  it.each(files(join(root, "app/(tg)")).filter((f) => /\/(page|layout)\.tsx$/.test(f)))("%s awaits requireFeaturePage()", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/await requireFeaturePage\(/);
  });

  // loading.tsx renders before the page's own guard and data, so it must be static:
  // no data, no server code, only the skeleton pieces.
  it.each(files(join(root, "app/(tg)")).filter((f) => /\/loading\.tsx$/.test(f)))("%s is a static skeleton", (f) => {
    const imports = [...readFileSync(f, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.every((i) => i === "@/components/tg/ui")).toBe(true);
    expect(readFileSync(f, "utf8")).not.toMatch(/\basync\b|await|fetch\(/);
  });

  it.each(files(join(root, "app/api/wb")).filter((f) => f.endsWith("route.ts")))("%s checks featureOff()", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/featureOff\(/);
  });

  it.each(files(join(root, "lib/wb/actions")))("every action in %s calls requireFeature()", (f) => {
    const src = readFileSync(f, "utf8");
    const actions = src.match(/^export async function \w+/gm) ?? [];
    const guarded = src.match(/^export async function \w+\([^)]*\)[^{]*\{\n\s+requireFeature\(\);/gm) ?? [];
    expect(actions.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(actions.length);
  });
});
