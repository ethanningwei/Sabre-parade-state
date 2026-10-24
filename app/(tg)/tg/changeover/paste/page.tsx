import { redirect } from "next/navigation";
import { PasteFlow } from "@/components/tg/changeover/paste-flow";
import { phaseOf } from "@/lib/wb/phase";
import { getCoy } from "@/lib/data/snapshot";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// Paste the Telegram list, then check it (mockups 4 and 5).
export default async function PastePage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  if ((await phaseOf((await getCoy()).id)) !== "VIGILANCE") redirect("/tg/changeover");
  return <PasteFlow />;
}
