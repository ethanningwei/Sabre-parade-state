import { redirect } from "next/navigation";
import { RaiseForm } from "@/components/tg/rf/raise-form";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { campAccess } from "@/lib/wb/domain/access";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo } from "@/lib/wb/forecast-data";

// Ask for manpower: a GC for his own camp, a PC/PS for their platoon's,
// OC/2IC/CSM/ASA for any guardroom. COY HQ isn't a guardroom.
export default async function RaiseRfPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const camps = (await campsInfo()).filter((c) => !c.isHq && campAccess(member, { subunitId: c.subunitId, campId: c.id }).asks);
  if (!camps.length) redirect("/tg");
  return <RaiseForm camps={camps.map((c) => ({ id: c.id, name: c.name, subunitName: c.subunitName }))} today={todaySgt()} />;
}
