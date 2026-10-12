import { createHmac } from "node:crypto";

export const TEST_BOT_TOKEN = "123456:TEST-not-a-real-token";

/** Builds initData the way Telegram signs it, for tests. */
export function signInitData(fields: Record<string, string>, botToken = TEST_BOT_TOKEN): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

export const tgUser = (id: number, first_name = "Test", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, first_name, ...extra });
