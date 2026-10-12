import type { Metadata } from "next";
import { TgShell } from "@/components/tg/tg-shell";
import { requireFeaturePage } from "@/lib/flags";
import { getMember } from "@/lib/wb/auth";
import "./telegram-theme.css";

export const metadata: Metadata = { title: "Sabre", robots: { index: false } };

// The Telegram Mini App. Its own sign-in (Telegram initData), never the v1
// password session. A 404 unless FEATURE_WHEREABOUTS=1.
export default async function TgLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage();
  const member = await getMember();
  return <TgShell signedIn={!!member}>{children}</TgShell>;
}
