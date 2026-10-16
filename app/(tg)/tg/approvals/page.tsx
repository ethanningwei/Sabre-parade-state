import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";

// Approvals is the Inbox's first tab now (2026-10-16). Kept so old links still land.
export default async function ApprovalsPage() {
  await requireFeaturePage();
  redirect("/tg/inbox?tab=approvals");
}
