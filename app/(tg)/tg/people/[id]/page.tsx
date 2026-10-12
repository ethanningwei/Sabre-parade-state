import { Header } from "@/components/tg/form-bits";
import { HistoryToggle } from "@/components/tg/history-toggle";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { accessTo, canDecide, isCurrent, liveChildren } from "@/lib/wb/domain/rules";
import { personWhere, recordsOfPerson } from "@/lib/wb/records";

// One person's records, newest first, with Void on what's approved or
// recorded. What's still current by default; Full history (?all=1) has the rest.
export default async function PersonHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  const p = /^[0-9a-f-]{36}$/.test(id) ? await personWhere(id) : null;
  if (!p || !canDecide(member.grants, p)) {
    return (
      <div className="flex flex-col gap-3">
        <Header title="Not found" />
        <p className="text-sm text-muted-foreground">That person isn&apos;t in your platoon, or has left the roster.</p>
      </div>
    );
  }
  const all = (await searchParams).all === "1";
  const everything = await recordsOfPerson(p.personId);
  const kids = liveChildren(everything);
  const now = new Date();
  const records = all ? everything : everything.filter((r) => isCurrent(r, kids.get(r.id) ?? [], now));
  return (
    <div className="flex flex-col gap-4">
      <Header title={`${p.rank} ${p.name}`} hint={`${p.campName} · ${p.subunitName}${all ? " · Full history" : ""}`} />
      {everything.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing on their timeline yet.</p>
      ) : records.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing current. What&apos;s over is in Full history.</p>
      ) : (
        records.map((r) => (
          <RecordSummary key={r.id} r={r} href={`/tg/records/${r.id}`}>
            <RecordActions recordId={r.id} can={accessTo(member, r)} />
          </RecordSummary>
        ))
      )}
      <HistoryToggle href={`/tg/people/${p.personId}`} all={all} count={everything.length} />
    </div>
  );
}
