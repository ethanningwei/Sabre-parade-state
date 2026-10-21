import { AddEventForm } from "@/components/tg/add-event-form";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { peopleInScope } from "@/lib/wb/records";

// PS/PC (their platoon), a GC (their camp), OC/2IC/CSM (everyone).
export default async function AddForSeveralPage() {
  await requireFeaturePage();
  const member = await requireScreenPage("add");
  return <AddEventForm people={await peopleInScope(member.grants, "proxy")} today={todaySgt()} />;
}
