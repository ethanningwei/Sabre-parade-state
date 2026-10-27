import { CalendarCheck, Inbox, SearchX } from "lucide-react";
import { BigLink, Header } from "@/components/tg/form-bits";
import { HistoryToggle } from "@/components/tg/history-toggle";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { RemoveFromRoster } from "@/components/tg/roster/remove-sheet";
import { StayoutSheet } from "@/components/tg/roster/stayout-sheet";
import { StatusesPanel } from "@/components/tg/statuses-panel";
import { EmptyState } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { manAccess, recordAccess } from "@/lib/wb/domain/access";
import { isCurrent, liveChildren } from "@/lib/wb/domain/rules";
import { statusesOf } from "@/lib/wb/domain/statuses";
import { stayoutLabel } from "@/lib/wb/domain/stayout";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { photoIds } from "@/lib/wb/medical";
import { personWhere, recordsOfPerson } from "@/lib/wb/records";
import { removalPreview } from "@/lib/wb/roster-flow";
import { stayoutOf } from "@/lib/wb/stayout";

// One person's records, newest first, with Void on what's approved or
// recorded. What's still current by default; Full history (?all=1) has the rest.
// At the bottom, Remove from roster for his PC/PS, company command and admins
// (?from=roster: opened from Roster, so it goes back there afterwards).
// For whoever may report for him (2026-10-24): Report sick and MA for him.
// His statuses are a panel of their own at the top, not in the list (2026-10-27).
// Stay-out is in the header; his PC/PS and company command change it (2026-10-27).
export default async function PersonHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string | string[]; from?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  const p = /^[0-9a-f-]{36}$/.test(id) ? await personWhere(id) : null;
  const can = p ? manAccess(member, p) : null;
  if (!p || !can?.history) {
    return (
      <EmptyState icon={<SearchX />} title="Not found">
        <p>That person isn&apos;t in your platoon, or has left the roster.</p>
      </EmptyState>
    );
  }
  const query = await searchParams;
  const all = query.all === "1";
  const [everything, counts, stayout] = await Promise.all([recordsOfPerson(p.personId), can.removes ? removalPreview(p.personId) : null, stayoutOf(p.personId)]);
  const now = new Date();
  const statuses = statusesOf(everything, now);
  // that a paper exists is only for those who may see it
  const photos = await photoIds(everything.filter((r) => r.kind === "STATUS" && recordAccess(member, r).seeMedical));
  const others = everything.filter((r) => r.kind !== "STATUS");
  const kids = liveChildren(everything);
  const records = all ? others : others.filter((r) => isCurrent(r, kids.get(r.id) ?? [], now));
  const reports = can.proxies && member.personId !== p.personId;
  const out = stayout?.registered ? stayoutLabel(stayout, todaySgt(now)) : null;
  return (
    <div className="flex flex-col gap-4">
      <Header title={`${p.rank} ${p.name}`} hint={[p.campName, p.subunitName, out && `Stay-out ${out === "Permanent" ? "(permanent)" : out}`, all && "Full history"].filter(Boolean).join(" · ")} />
      <StatusesPanel live={statuses.live} past={statuses.past} photos={photos} />
      {reports && (
        <div className="grid grid-cols-2 gap-2">
          <BigLink href={`/tg/apply/sick?for=${p.personId}`} outline>
            Report sick
          </BigLink>
          <BigLink href={`/tg/apply/ma?for=${p.personId}`} outline>
            Report an MA
          </BigLink>
        </div>
      )}
      {others.length === 0 ? (
        <EmptyState icon={<Inbox />} title="Nothing on their timeline yet" />
      ) : records.length === 0 ? (
        <EmptyState icon={<CalendarCheck />} title="Nothing current">
          <p>What&apos;s over is in Full history.</p>
        </EmptyState>
      ) : (
        records.map((r, i) => (
          <RecordSummary key={r.id} r={r} i={i} href={`/tg/records/${r.id}`}>
            <RecordActions recordId={r.id} can={recordAccess(member, r)} />
          </RecordSummary>
        ))
      )}
      <HistoryToggle href={`/tg/people/${p.personId}`} all={all} count={others.length} />
      {can.stayout && stayout?.registered && (
        <StayoutSheet
          personId={p.personId}
          name={`${p.rank} ${p.name}`}
          stayout={stayout.stayout}
          until={stayout.stayoutUntil}
          label={out ?? "No"}
        />
      )}
      {counts && (
        <div id="remove" className="mt-4 scroll-mt-4">
          <RemoveFromRoster personId={p.personId} name={`${p.rank} ${p.name}`} counts={counts} after={query.from === "roster" ? "/tg/roster" : undefined} />
        </div>
      )}
    </div>
  );
}
