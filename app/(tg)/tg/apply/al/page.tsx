import { LeaveForm } from "@/components/tg/apply/leave-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { needsNoApproval } from "@/lib/wb/domain/access";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

export default async function ApplyALPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  return <LeaveForm kind="AL" today={todaySgt()} leaveLeft={member.leaveLeft ?? 0} noApproval={needsNoApproval(member)} />;
}
