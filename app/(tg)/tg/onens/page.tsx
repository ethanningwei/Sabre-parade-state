import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";

// ONENS owed is the Inbox's second tab now (2026-10-16). Kept so old links still land.
export default async function OnensPage() {
  await requireFeaturePage();
  redirect("/tg/inbox?tab=onens");
}
