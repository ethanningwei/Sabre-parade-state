"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  endSession,
  passwordMatches,
  passwordSignInEnabled,
  recordFailure,
  signInBot,
  startSession,
  tooManyFailures,
} from "@/lib/session";

export type LoginState = { error: string | null; name: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const name = String(formData.get("name") ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const password = String(formData.get("password") ?? "");

  if (!passwordSignInEnabled()) {
    return { error: `Sign in from Telegram: open @${signInBot()} and tap Parade state.`, name };
  }
  if (name.length < 2 || name.length > 60) return { error: "Enter your rank and name, e.g. 3SG TAN.", name };

  const ip = await clientIp();
  if (await tooManyFailures(ip)) {
    return { error: "Too many wrong passwords. Wait 15 minutes and try again.", name };
  }
  if (!passwordMatches(password)) {
    await recordFailure(ip);
    await new Promise((r) => setTimeout(r, 600)); // slows down guessing
    return { error: "Wrong password.", name };
  }

  await startSession(name);
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
