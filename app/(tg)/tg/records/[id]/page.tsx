import { SearchX } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { ParadeStatusLine } from "@/components/tg/parade-status";
import { EmptyState } from "@/components/tg/ui";
import { VisitSection } from "@/components/tg/visit-section";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { KIND_LABEL } from "@/lib/wb/domain/describe";
import { recordAccess, visitAccess } from "@/lib/wb/domain/access";
import { isOutcome, VISIT_KINDS } from "@/lib/wb/domain/rules";
import { photoIds, readDiagnoses } from "@/lib/wb/medical";
import { paradeStatuses } from "@/lib/wb/projection";
import { recordView } from "@/lib/wb/records";
import { visitOf } from "@/lib/wb/visits";

const when = (d: Date) =>
  d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// One record: opened from My records, Approvals, a person's history, or a card's Open button.
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  const r = /^[0-9a-f-]{36}$/.test(id) ? await recordView(id) : null;

  if (!r || !recordAccess(member, r).view) {
    return (
      <EmptyState icon={<SearchX />} title="Not found">
        <p>That record doesn&apos;t exist, or it isn&apos;t yours or your platoon&apos;s to see.</p>
      </EmptyState>
    );
  }

  const medical = VISIT_KINDS.includes(r.kind) || isOutcome(r.kind);
  const visit = medical ? await visitOf(r.id) : null;
  const onVisit = visit ? visitAccess(member, visit) : null;
  // once he's recorded what the doctor gave, the approval can only be voided
  const can = recordAccess(member, { ...r, hasOutcome: !!visit && r.id === visit.anchor.id && visit.outcome.length > 0 });
  // the diagnosis and photo: read (and audited) only for someone allowed, and only when there's an outcome to show
  const sees = !!visit && !!onVisit?.seeMedical && visit.outcome.length > 0;
  const diagnoses = sees ? await readDiagnoses(member, visit.outcome, "MINIAPP") : null;
  const photo = sees ? [...(await photoIds(visit.outcome))][0] ?? null : null;
  const canOutcome = !!onVisit?.recordOutcome;
  // a pending or rejected report sick has nothing to show yet
  const showVisit = !!visit && (canOutcome || visit.outcome.length > 0 || !!visit.anchor.outcomeAt);
  // projection on: is it on the parade state yet?
  const parade = (await paradeStatuses([r])).get(r.id);

  return (
    <div className="flex flex-col gap-4">
      <Header title={KIND_LABEL[r.kind]} hint={`${r.rank} ${r.name} · ${r.campName} · ${r.subunitName}`} />
      <RecordSummary r={r}>
        <RecordActions recordId={r.id} can={can} />
      </RecordSummary>
      {parade && (
        <p className="px-1">
          <ParadeStatusLine s={parade} />
        </p>
      )}
      {visit && showVisit && (
        <VisitSection
          outcome={visit.outcome}
          answered={visit.outcome.length > 0 || !!visit.anchor.outcomeAt}
          diagnoses={diagnoses}
          photoId={photo}
          outcomeHref={canOutcome ? `/tg/records/${visit.anchor.id}/outcome` : null}
          canMarkOnens={!!onVisit?.markOnens}
          own={!!member.personId && member.personId === r.personId}
        />
      )}
      <p className="px-1 text-xs text-muted-foreground">
        {r.createdVia === "PROXY" ? "Added by a commander" : "Sent"} {when(r.createdAt)}
        {r.decidedAt && ` · decided ${when(r.decidedAt)}`}
      </p>
    </div>
  );
}
