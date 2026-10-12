import Link from "next/link";
import { Header } from "@/components/tg/form-bits";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { buttonVariants } from "@/components/ui/button";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { accessTo, isLive, VISIT_KINDS } from "@/lib/wb/domain/rules";
import { rosterSelf } from "@/lib/wb/me";
import { recordsOfPerson } from "@/lib/wb/records";

// My records: everything on my timeline, newest first. Withdraw what's pending.
// What a doctor gave sits under the visit it came from, so one afternoon reads
// as one card; a corrected or voided outcome isn't repeated.
export default async function MyRecordsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;
  const all = await recordsOfPerson(me.personId);
  const ids = new Set(all.map((r) => r.id));
  const under = new Map<string, typeof all>();
  for (const r of all) {
    if (r.parentId && ids.has(r.parentId) && isLive(r.state)) under.set(r.parentId, [...(under.get(r.parentId) ?? []), r]);
  }
  // children are shown under their parent; dead outcomes (corrected, voided with their visit) drop out
  const records = all.filter((r) => !(r.parentId && ids.has(r.parentId)) && !(r.state === "CANCELLED" && r.decisionNote?.startsWith("Corrected by")));
  const waiting = (r: (typeof all)[number]) =>
    VISIT_KINDS.includes(r.kind) && (r.kind === "MA" ? r.state === "RECORDED" : r.state === "APPROVED") && !r.outcomeAt && !under.get(r.id)?.length;

  return (
    <div className="flex flex-col gap-4">
      <Header title="My records" hint={`You have ${member.leaveLeft ?? 0} days of leave left.`} />
      <Link href="/tg/apply/outcome" className="rounded-xl border border-dashed px-4 py-3 text-sm active:bg-muted">
        Saw a doctor without reporting sick first? <span className="font-medium underline">Record an MC or status</span>
      </Link>
      {records.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing yet. Report sick, MCs, leave, off, MAs and courses show up here.
          <Link href="/tg/apply" className={buttonVariants({ size: "lg", className: "h-11" })}>
            Apply or report
          </Link>
        </div>
      ) : (
        records.map((r) => {
          const can = accessTo(member, r);
          return (
            <RecordSummary key={r.id} r={r} href={`/tg/records/${r.id}`} under={under.get(r.id)}>
              {can.withdraw && <RecordActions recordId={r.id} can={{ ...can, decide: false, undo: false, sayWhy: false, void: false }} />}
              {waiting(r) && (
                <Link href={`/tg/records/${r.id}/outcome`} className={buttonVariants({ size: "lg", className: "h-11" })}>
                  💊 Update outcome
                </Link>
              )}
            </RecordSummary>
          );
        })
      )}
    </div>
  );
}
