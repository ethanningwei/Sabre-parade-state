import { EventForm } from "@/components/tg/apply/event-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

export default async function ApplyEventPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  return <EventForm today={todaySgt()} />;
}
