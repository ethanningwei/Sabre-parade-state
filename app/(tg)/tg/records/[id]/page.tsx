import { Header } from "@/components/tg/form-bits";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { KIND_LABEL } from "@/lib/wb/domain/describe";
import { accessTo } from "@/lib/wb/domain/rules";
import { recordView } from "@/lib/wb/records";

const when = (d: Date) =>
  d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// One record: opened from My records, Approvals, a person's history, or a card's Open button.
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  const r = /^[0-9a-f-]{36}$/.test(id) ? await recordView(id) : null;
  const can = r ? accessTo(member, r) : null;

  if (!r || !can?.view) {
    return (
      <div className="flex flex-col gap-3">
        <Header title="Not found" />
        <p className="text-sm text-muted-foreground">That record doesn&apos;t exist, or it isn&apos;t yours or your platoon&apos;s to see.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header title={KIND_LABEL[r.kind]} hint={`${r.rank} ${r.name} · ${r.campName} · ${r.subunitName}`} />
      <RecordSummary r={r}>
        <RecordActions recordId={r.id} can={can} />
      </RecordSummary>
      <p className="text-xs text-muted-foreground">
        {r.createdVia === "PROXY" ? "Added by a commander" : "Sent"} {when(r.createdAt)}
        {r.decidedAt && ` · decided ${when(r.decidedAt)}`}
      </p>
    </div>
  );
}
