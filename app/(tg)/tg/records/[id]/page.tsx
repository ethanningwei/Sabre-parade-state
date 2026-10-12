import { Header } from "@/components/tg/form-bits";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { VisitSection } from "@/components/tg/visit-section";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { KIND_LABEL } from "@/lib/wb/domain/describe";
import { accessTo, canDecide, canSeeMedical, isOutcome, outcomeParentRefusal, VISIT_KINDS } from "@/lib/wb/domain/rules";
import { photoIds, readDiagnoses } from "@/lib/wb/medical";
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
  const can = r ? accessTo(member, r) : null;

  if (!r || !can?.view) {
    return (
      <div className="flex flex-col gap-3">
        <Header title="Not found" />
        <p className="text-sm text-muted-foreground">That record doesn&apos;t exist, or it isn&apos;t yours or your platoon&apos;s to see.</p>
      </div>
    );
  }

  const medical = VISIT_KINDS.includes(r.kind) || isOutcome(r.kind);
  const visit = medical ? await visitOf(r.id) : null;
  const owner = !!member.personId && member.personId === r.personId;
  // the diagnosis and photo: read (and audited) only for someone allowed, and only when there's an outcome to show
  const sees = !!visit && canSeeMedical(member, visit.anchor) && visit.outcome.length > 0;
  const diagnoses = sees ? await readDiagnoses(member, visit.outcome, "MINIAPP") : null;
  const photo = sees ? [...(await photoIds(visit.outcome))][0] ?? null : null;
  const canOutcome =
    !!visit && owner && (visit.parentKind ? outcomeParentRefusal(visit.anchor, member.personId!) === null : visit.outcome.length > 0);
  // a pending or rejected report sick has nothing to show yet
  const showVisit = !!visit && (canOutcome || visit.outcome.length > 0 || !!visit.anchor.outcomeAt);

  return (
    <div className="flex flex-col gap-4">
      <Header title={KIND_LABEL[r.kind]} hint={`${r.rank} ${r.name} · ${r.campName} · ${r.subunitName}`} />
      <RecordSummary r={r}>
        {/* once he's recorded what the doctor gave, the approval can only be voided (decide.ts undo refuses too) */}
        <RecordActions recordId={r.id} can={visit && r.id === visit.anchor.id && visit.outcome.length ? { ...can, undo: false } : can} />
      </RecordSummary>
      {visit && showVisit && (
        <VisitSection
          outcome={visit.outcome}
          answered={visit.outcome.length > 0 || !!visit.anchor.outcomeAt}
          diagnoses={diagnoses}
          photoId={photo}
          outcomeHref={canOutcome ? `/tg/records/${visit.anchor.id}/outcome` : null}
          canMarkOnens={owner || canDecide(member.grants, visit.anchor)}
          own={owner}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {r.createdVia === "PROXY" ? "Added by a commander" : "Sent"} {when(r.createdAt)}
        {r.decidedAt && ` · decided ${when(r.decidedAt)}`}
      </p>
    </div>
  );
}
