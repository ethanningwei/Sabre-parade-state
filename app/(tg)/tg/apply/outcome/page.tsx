import { OutcomeForm } from "@/components/tg/apply/outcome-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

// An MC or status from a doctor he saw without reporting sick first: a weekend, or on leave.
export default async function RecordOutcomePage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  return <OutcomeForm today={todaySgt()} anchorId={null} parentKind={null} visitLine="Saw a doctor without reporting sick first? Record it here." hasPhoto={false} />;
}
