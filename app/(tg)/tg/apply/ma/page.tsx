import { ForManLink } from "@/components/tg/apply/for-man";
import { ManPicker } from "@/components/tg/apply/man-picker";
import { MaForm } from "@/components/tg/apply/ma-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";
import { lastMa } from "@/lib/wb/records";
import { forManOf, menToReportFor, reportedItems, reportsForMen } from "@/lib/wb/report-for";

// His own MA, or (?for=<id>, 2026-10-24) one for a man in his reach; ?for=pick is the man picker.
export default async function ApplyMaPage({ searchParams }: { searchParams: Promise<{ for?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const forParam = (await searchParams).for;
  const canFor = reportsForMen(member);
  const today = todaySgt();
  if (canFor && typeof forParam === "string") {
    const man = forParam === "pick" ? null : await forManOf(member, forParam);
    if (man) return <MaForm key={man.personId} today={today} last={await lastMa(man.personId)} forMan={man} />;
    return <ManPicker title="Medical appointment for one of my men" people={await menToReportFor(member)} hrefBase="/tg/apply/ma?for=" />;
  }
  const me = await rosterSelf(member);
  if (!me) return canFor ? <ManPicker title="Medical appointment for one of my men" people={await menToReportFor(member)} hrefBase="/tg/apply/ma?for=" /> : <NotOnRoster />;
  return (
    <div className="flex flex-col gap-5">
      {canFor && <ForManLink href="/tg/apply/ma?for=pick" label="For one of my men" />}
      <MaForm today={today} last={await lastMa(me.personId)} reported={await reportedItems(me.personId, today)} />
    </div>
  );
}
