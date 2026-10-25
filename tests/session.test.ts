import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordMatches, passwordSignInEnabled, signInBot } from "@/lib/session";

afterEach(() => vi.unstubAllEnvs());

describe("shared password", () => {
  it("accepts only the exact password", () => {
    vi.stubEnv("APP_PASSWORD", "correct horse battery");
    expect(passwordMatches("correct horse battery")).toBe(true);
    expect(passwordMatches("correct horse batter")).toBe(false);
    expect(passwordMatches("Correct horse battery")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });

  it("refuses to run without a configured password", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(() => passwordMatches("")).toThrow(/APP_PASSWORD/);
  });

  it("is off when no password is configured, pointing to the bot", () => {
    vi.stubEnv("APP_PASSWORD", "correct horse battery");
    expect(passwordSignInEnabled()).toBe(true);
    vi.stubEnv("APP_PASSWORD", "");
    expect(passwordSignInEnabled()).toBe(false);

    vi.stubEnv("WB_BOT_USERNAME", "");
    expect(signInBot()).toBe("sabreopsbot");
    vi.stubEnv("WB_BOT_USERNAME", "@sabretestbot");
    expect(signInBot()).toBe("sabretestbot");
  });
});
