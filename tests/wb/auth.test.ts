import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapAdminIds,
  grantCovers,
  hasGrant,
  signSession,
  verifyInitData,
  verifySession,
  type GrantRow,
} from "@/lib/wb/auth";
import { signInitData, TEST_BOT_TOKEN, tgUser } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

const NOW = 1_790_000_000;

describe("initData verification", () => {
  const fields = { auth_date: String(NOW - 60), query_id: "AAH", user: tgUser(42, "Tan", { username: "tan" }), signature: "sig" };

  it("accepts data signed with the bot token", () => {
    const v = verifyInitData(signInitData(fields), TEST_BOT_TOKEN, NOW);
    expect(v?.user).toMatchObject({ id: 42, first_name: "Tan", username: "tan" });
    expect(v?.authDate).toBe(NOW - 60);
    expect(v?.startParam).toBeNull();
  });

  it("passes start_param through", () => {
    const v = verifyInitData(signInitData({ ...fields, start_param: "admin" }), TEST_BOT_TOKEN, NOW);
    expect(v?.startParam).toBe("admin");
  });

  it("rejects tampered data", () => {
    const signed = signInitData(fields);
    const tampered = signed.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(tampered).not.toBe(signed);
    expect(verifyInitData(tampered, TEST_BOT_TOKEN, NOW)).toBeNull();
  });

  it("rejects a signature made with another bot's token", () => {
    expect(verifyInitData(signInitData(fields, "999:OTHER"), TEST_BOT_TOKEN, NOW)).toBeNull();
  });

  it("rejects data older than 24 hours, and from the future", () => {
    const old = signInitData({ ...fields, auth_date: String(NOW - 24 * 3600 - 1) });
    expect(verifyInitData(old, TEST_BOT_TOKEN, NOW)).toBeNull();
    const justInTime = signInitData({ ...fields, auth_date: String(NOW - 24 * 3600 + 5) });
    expect(verifyInitData(justInTime, TEST_BOT_TOKEN, NOW)).not.toBeNull();
    const future = signInitData({ ...fields, auth_date: String(NOW + 3600) });
    expect(verifyInitData(future, TEST_BOT_TOKEN, NOW)).toBeNull();
  });

  it("rejects missing hash, missing user and garbage", () => {
    expect(verifyInitData("", TEST_BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData("auth_date=1&user=x", TEST_BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData({ auth_date: String(NOW) }), TEST_BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData({ ...fields, user: "not json" }), TEST_BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData(fields), "", NOW)).toBeNull();
  });
});

describe("session cookie", () => {
  const SECRET = "a-test-secret-of-enough-length";
  const s = { mid: "6c1f7f8e-0000-4000-8000-000000000001", tg: 42, exp: NOW + 100 };

  it("round-trips", () => {
    expect(verifySession(signSession(s, SECRET), SECRET, NOW)).toEqual(s);
  });

  it("rejects a forged body, a wrong secret, expiry and junk", () => {
    const token = signSession(s, SECRET);
    const [, mac] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...s, mid: "someone-else" })).toString("base64url");
    expect(verifySession(`${forgedBody}.${mac}`, SECRET, NOW)).toBeNull();
    expect(verifySession(token, "another-secret-of-enough-length", NOW)).toBeNull();
    expect(verifySession(token, SECRET, NOW + 100)).toBeNull();
    expect(verifySession(undefined, SECRET, NOW)).toBeNull();
    expect(verifySession("abc", SECRET, NOW)).toBeNull();
    expect(verifySession(`${token}.x`, SECRET, NOW)).toBeNull();
  });
});

describe("grant scope", () => {
  const PL6 = "pl6";
  const PL7 = "pl7";
  const SFT_A = "sft-a";
  const company: GrantRow = { role: "OC", subunitId: null, campId: null };
  const ps6: GrantRow = { role: "PS", subunitId: PL6, campId: null };
  const gcSftA: GrantRow = { role: "GC", subunitId: null, campId: SFT_A };

  it("checks the role", () => {
    expect(grantCovers(ps6, ["PC"], "any")).toBe(false);
    expect(grantCovers(ps6, ["PC", "PS"], "any")).toBe(true);
  });

  it("a company-wide grant covers everything", () => {
    expect(grantCovers(company, ["OC"], "company")).toBe(true);
    expect(grantCovers(company, ["OC"], { subunitId: PL7 })).toBe(true);
    expect(grantCovers(company, ["OC"], { subunitId: PL7, campId: SFT_A })).toBe(true);
  });

  it("a platoon grant covers that platoon and its camps only", () => {
    expect(grantCovers(ps6, ["PS"], { subunitId: PL6 })).toBe(true);
    expect(grantCovers(ps6, ["PS"], { subunitId: PL6, campId: SFT_A })).toBe(true);
    expect(grantCovers(ps6, ["PS"], { subunitId: PL7 })).toBe(false);
    expect(grantCovers(ps6, ["PS"], "company")).toBe(false);
  });

  it("a camp grant covers that camp only", () => {
    expect(grantCovers(gcSftA, ["GC"], { subunitId: PL6, campId: SFT_A })).toBe(true);
    expect(grantCovers(gcSftA, ["GC"], { subunitId: PL6, campId: "sft-b" })).toBe(false);
    expect(grantCovers(gcSftA, ["GC"], { subunitId: PL6 })).toBe(false);
  });

  it("ADMIN is a role like any other, not a wildcard", () => {
    const admin: GrantRow = { role: "ADMIN", subunitId: null, campId: null };
    expect(hasGrant([admin], ["PS", "PC"], { subunitId: PL6 })).toBe(false);
    expect(hasGrant([admin], ["PS", "PC", "ADMIN"], { subunitId: PL6 })).toBe(true);
    expect(hasGrant([], ["ADMIN"], "any")).toBe(false);
  });
});

describe("bootstrap admins", () => {
  it("parses WB_ADMIN_TELEGRAM_IDS", () => {
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", " 111, 222 ,,abc,-5");
    expect(bootstrapAdminIds()).toEqual([111, 222]);
    vi.stubEnv("WB_ADMIN_TELEGRAM_IDS", "");
    expect(bootstrapAdminIds()).toEqual([]);
  });
});
