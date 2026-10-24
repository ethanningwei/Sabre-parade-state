import { ForManLink } from "@/components/tg/apply/for-man";
import { ManPicker } from "@/components/tg/apply/man-picker";
import { SickForm } from "@/components/tg/apply/sick-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { approverOf } from "@/lib/wb/domain/access";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";
import { forManOf, menToReportFor, reportedItems, reportsForMen } from "@/lib/wb/report-for";

// His own report sick, or (?for=<id>, 2026-10-24) one for a man in his reach;
// ?for=pick is the man picker.
export default async function ApplySickPage({ searchParams }: { searchParams: Promise<{ for?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const forParam = (await searchParams).for;
  const canFor = reportsForMen(member);
  const today = todaySgt();
  if (canFor && typeof forParam === "string") {
    const man = forParam === "pick" ? null : await forManOf(member, forParam);
    if (man) return <SickForm key={man.personId} today={today} approver={null} forMan={man} />;
    return <ManPicker title="Report sick for one of my men" people={await menToReportFor(member)} hrefBase="/tg/apply/sick?for=" />;
  }
  const me = await rosterSelf(member);
  if (!me) return canFor ? <ManPicker title="Report sick for one of my men" people={await menToReportFor(member)} hrefBase="/tg/apply/sick?for=" /> : <NotOnRoster />;
  return (
    <div className="flex flex-col gap-5">
      {canFor && <ForManLink href="/tg/apply/sick?for=pick" label="For one of my men" />}
      <SickForm today={today} approver={approverOf(member.grants.map((g) => g.role))} reported={await reportedItems(me.personId, today)} />
    </div>
  );
}
