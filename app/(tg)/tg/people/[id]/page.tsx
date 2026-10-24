import { CalendarCheck, Inbox, SearchX } from "lucide-react";
import { BigLink, Header } from "@/components/tg/form-bits";
import { HistoryToggle } from "@/components/tg/history-toggle";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { RemoveFromRoster } from "@/components/tg/roster/remove-sheet";
import { EmptyState } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { manAccess, recordAccess } from "@/lib/wb/domain/access";
import { isCurrent, liveChildren } from "@/lib/wb/domain/rules";
import { personWhere, recordsOfPerson } from "@/lib/wb/records";
import { removalPreview } from "@/lib/wb/roster-flow";

// One person's records, newest first, with Void on what's approved or
// recorded. What's still current by default; Full history (?all=1) has the rest.
// At the bottom, Remove from roster for his PC/PS, company command and admins
// (?from=roster: opened from Roster, so it goes back there afterwards).
// For whoever may report for him (2026-10-24): Report sick and MA for him.
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
  const [everything, counts] = await Promise.all([recordsOfPerson(p.personId), can.removes ? removalPreview(p.personId) : null]);
  const kids = liveChildren(everything);
  const now = new Date();
  const records = all ? everything : everything.filter((r) => isCurrent(r, kids.get(r.id) ?? [], now));
  const reports = can.proxies && member.personId !== p.personId;
  return (
    <div className="flex flex-col gap-4">
      <Header title={`${p.rank} ${p.name}`} hint={`${p.campName} · ${p.subunitName}${all ? " · Full history" : ""}`} />
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
      {everything.length === 0 ? (
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
      <HistoryToggle href={`/tg/people/${p.personId}`} all={all} count={everything.length} />
      {counts && (
        <div id="remove" className="mt-4 scroll-mt-4">
          <RemoveFromRoster personId={p.personId} name={`${p.rank} ${p.name}`} counts={counts} after={query.from === "roster" ? "/tg/roster" : undefined} />
        </div>
      )}
    </div>
  );
}
