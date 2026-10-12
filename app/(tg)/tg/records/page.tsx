import Link from "next/link";
import { Header } from "@/components/tg/form-bits";
import { HistoryToggle } from "@/components/tg/history-toggle";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { buttonVariants } from "@/components/ui/button";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { outcomeOrder } from "@/lib/wb/decide";
import { accessTo, awaitsOutcome, isCurrent, nestOutcomes } from "@/lib/wb/domain/rules";
import { rosterSelf } from "@/lib/wb/me";
import { recordsOfPerson } from "@/lib/wb/records";

// My records: what's still current, newest first, with Full history (?all=1)
// one tap away. Withdraw what's pending. What a doctor gave sits under the
// visit it came from, so one afternoon reads as one card; a corrected or
// voided outcome isn't repeated.
export default async function MyRecordsPage({ searchParams }: { searchParams: Promise<{ all?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;
  const all = (await searchParams).all === "1";
  const { top, under } = nestOutcomes(await recordsOfPerson(me.personId));
  for (const kids of under.values()) outcomeOrder(kids);
  const now = new Date();
  const records = all ? top : top.filter((r) => isCurrent(r, under.get(r.id) ?? [], now));

  return (
    <div className="flex flex-col gap-4">
      <Header title={all ? "Full history" : "My records"} hint={`You have ${member.leaveLeft ?? 0} days of leave left.`} />
      <Link href="/tg/apply/outcome" className="rounded-xl border border-dashed px-4 py-3 text-sm active:bg-muted">
        Saw a doctor without reporting sick first? <span className="font-medium underline">Record an MC or status</span>
      </Link>
      {top.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing yet. Report sick, MCs, leave, off, MAs and courses show up here.
          <Link href="/tg/apply" className={buttonVariants({ size: "lg", className: "h-11" })}>
            Apply or report
          </Link>
        </div>
      ) : records.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing current. What&apos;s over is in Full history.</p>
      ) : (
        records.map((r) => {
          const can = accessTo(member, r);
          return (
            <RecordSummary key={r.id} r={r} href={`/tg/records/${r.id}`} under={under.get(r.id)}>
              {can.withdraw && <RecordActions recordId={r.id} can={{ ...can, decide: false, undo: false, sayWhy: false, void: false }} />}
              {awaitsOutcome(r, under.get(r.id) ?? []) && (
                <Link href={`/tg/records/${r.id}/outcome`} className={buttonVariants({ size: "lg", className: "h-11" })}>
                  💊 Update outcome
                </Link>
              )}
            </RecordSummary>
          );
        })
      )}
      <HistoryToggle href="/tg/records" all={all} count={top.length} />
    </div>
  );
}
