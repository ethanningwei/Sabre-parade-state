import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";

// Gaps became Roster (2026-10-19). "Open Gaps" buttons already sent in chats land here.
export default async function GapsPage() {
  await requireFeaturePage();
  redirect("/tg/roster");
}
