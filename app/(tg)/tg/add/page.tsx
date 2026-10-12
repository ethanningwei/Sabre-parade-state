import { redirect } from "next/navigation";
import { AddEventForm } from "@/components/tg/add-event-form";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { proxiesAnything } from "@/lib/wb/domain/rules";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { peopleInScope } from "@/lib/wb/records";

// PS/PC (their platoon), a GC (their camp), OC/2IC/CSM (everyone).
export default async function AddForSeveralPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!proxiesAnything(member.grants)) redirect("/tg");
  return <AddEventForm people={await peopleInScope(member.grants, "proxy")} today={todaySgt()} />;
}
