import Link from "next/link";
import { Header } from "@/components/tg/form-bits";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { buttonVariants } from "@/components/ui/button";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { accessTo } from "@/lib/wb/domain/rules";
import { rosterSelf } from "@/lib/wb/me";
import { recordsOfPerson } from "@/lib/wb/records";

// My records: everything on my timeline, newest first. Withdraw what's pending.
export default async function MyRecordsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;
  const records = await recordsOfPerson(me.personId);

  return (
    <div className="flex flex-col gap-4">
      <Header title="My records" hint={`You have ${member.leaveLeft ?? 0} days of leave left.`} />
      {records.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing yet. Leave, off, MAs and courses you apply for or report show up here.
          <Link href="/tg/apply" className={buttonVariants({ size: "lg", className: "h-11" })}>
            Apply or report
          </Link>
        </div>
      ) : (
        records.map((r) => {
          const can = accessTo(member, r);
          return (
            <RecordSummary key={r.id} r={r} href={`/tg/records/${r.id}`}>
              {can.withdraw && <RecordActions recordId={r.id} can={{ ...can, decide: false, undo: false, sayWhy: false, void: false }} />}
            </RecordSummary>
          );
        })
      )}
    </div>
  );
}
