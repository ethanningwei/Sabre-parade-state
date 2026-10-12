import { Header } from "@/components/tg/form-bits";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { accessTo, canDecide } from "@/lib/wb/domain/rules";
import { personWhere, recordsOfPerson } from "@/lib/wb/records";

// One person's records, newest first, with Void on what's approved or recorded.
export default async function PersonHistoryPage({ params }: { params: Promise<{ id: string }> }) {
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
  const records = await recordsOfPerson(p.personId);
  return (
    <div className="flex flex-col gap-4">
      <Header title={`${p.rank} ${p.name}`} hint={`${p.campName} · ${p.subunitName}`} />
      {records.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing on their timeline yet.</p>
      ) : (
        records.map((r) => (
          <RecordSummary key={r.id} r={r} href={`/tg/records/${r.id}`}>
            <RecordActions recordId={r.id} can={accessTo(member, r)} />
          </RecordSummary>
        ))
      )}
    </div>
  );
}
