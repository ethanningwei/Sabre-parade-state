import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { accessTo, decidesAnything } from "@/lib/wb/domain/rules";
import { pendingFor } from "@/lib/wb/records";

// Requests waiting on this commander: the same Approve/Reject as the card,
// for when a platoon has no commanders chat linked or the card has scrolled away.
export default async function ApprovalsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!decidesAnything(member.grants)) redirect("/tg");
  const pending = await pendingFor(member.grants);

  return (
    <div className="flex flex-col gap-4">
      <Header title="Approvals" hint={pending.length ? `${pending.length} waiting, oldest first.` : undefined} />
      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing waiting on you.</p>
      ) : (
        pending.map((r) => (
          <RecordSummary key={r.id} r={r} showWho href={`/tg/records/${r.id}`}>
            <RecordActions recordId={r.id} can={accessTo(member, r)} />
          </RecordSummary>
        ))
      )}
    </div>
  );
}
