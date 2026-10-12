import { LeaveForm } from "@/components/tg/apply/leave-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

export default async function ApplyOFFPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  return <LeaveForm kind="OFF" today={todaySgt()} leaveLeft={member.leaveLeft ?? 0} />;
}
