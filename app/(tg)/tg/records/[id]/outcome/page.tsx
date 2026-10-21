import { OutcomeForm } from "@/components/tg/apply/outcome-form";
import { Header } from "@/components/tg/form-bits";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { recordWhat } from "@/lib/wb/domain/describe";
import { visitAccess } from "@/lib/wb/domain/access";
import { outcomeParentRefusal } from "@/lib/wb/domain/rules";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { photoIds, readDiagnoses } from "@/lib/wb/medical";
import { answersFrom, visitOf } from "@/lib/wb/visits";

// Update outcome (an approved RSI/RSO, or an MA) or correct one already
// recorded. The trooper's own only: his commanders read it, they don't write it.
export default async function OutcomePage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  const visit = /^[0-9a-f-]{36}$/.test(id) ? await visitOf(id) : null;
  if (!visit || !visitAccess(member, visit).recordOutcome) {
    // the reason in words, when it's his own visit that isn't ready
    const mine = !!visit && !!member.personId && visit.anchor.personId === member.personId;
    const refusal = visit && mine && visit.parentKind ? outcomeParentRefusal(visit.anchor, member.personId!) : null;
    return (
      <div className="flex flex-col gap-3">
        <Header title="Can't record an outcome here" />
        <p className="text-sm text-muted-foreground">{refusal ?? "That isn't a report sick or MC of yours that's still standing."}</p>
      </div>
    );
  }

  const today = todaySgt();
  const answered = visit.outcome.length > 0 || !!visit.anchor.outcomeAt;
  // correcting: start from what's recorded now (his own diagnosis: still an audited read)
  const initial = answered ? answersFrom(visit.outcome, await readDiagnoses(member, visit.outcome, "MINIAPP"), today) : undefined;
  const hasPhoto = (await photoIds(visit.outcome)).size > 0;
  return (
    <OutcomeForm
      today={today}
      anchorId={visit.anchor.id}
      parentKind={visit.parentKind}
      visitLine={visit.parentKind ? `After ${recordWhat(visit.anchor)}` : undefined}
      initial={initial}
      hasPhoto={hasPhoto}
    />
  );
}
