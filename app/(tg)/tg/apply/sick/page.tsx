import { SickForm } from "@/components/tg/apply/sick-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { approverOf } from "@/lib/wb/domain/access";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

export default async function ApplySickPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  return <SickForm today={todaySgt()} approver={approverOf(member.grants.map((g) => g.role))} />;
}
