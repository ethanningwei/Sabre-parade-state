import Link from "next/link";
import { KIND_LABEL, STATE_LABEL } from "@/lib/wb/domain/describe";
import { costsLeave, type WbRecordState } from "@/lib/wb/domain/rules";
import { dayMonthYear, rangeLabel } from "@/lib/wb/domain/timeline";
import type { RecordView } from "@/lib/wb/records";

// One record, as a card. Server-rendered; actions are a separate client component.

const CHIP: Record<WbRecordState, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  RECORDED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  REJECTED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

export function StateChip({ state }: { state: WbRecordState }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[state]}`}>{STATE_LABEL[state]}</span>;
}

/** The second line: where, why, what it costs, or the event and its hours. */
function details(r: RecordView): string {
  switch (r.kind) {
    case "AL":
    case "OL":
      return [r.location && `@ ${r.location}`, r.reason, costsLeave(r.kind) && r.leaveDays ? `${r.leaveDays} day${r.leaveDays === 1 ? "" : "s"} of leave` : ""]
        .filter(Boolean)
        .join(" · ");
    case "MA":
      return `${r.maTiming}H @ ${r.location}`;
    case "EVENT":
      return r.detail;
    default:
      return r.detail;
  }
}

function decision(r: RecordView): string | null {
  switch (r.state) {
    case "APPROVED":
      return `Approved by ${r.deciderLabel ?? "a commander"}`;
    case "REJECTED":
      return `Rejected by ${r.deciderLabel ?? "a commander"}${r.decisionNote ? `: “${r.decisionNote}”` : ""}`;
    case "CANCELLED":
      return r.decisionNote ?? "Voided";
    case "PENDING":
      return "Waiting for your PC or PS";
    default:
      return r.createdVia === "PROXY" ? "Added by a commander" : null;
  }
}

export function RecordSummary({ r, showWho, href, children }: { r: RecordView; showWho?: boolean; href?: string; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{KIND_LABEL[r.kind]}</p>
        <StateChip state={r.state} />
      </div>
      {showWho && (
        <p className="text-sm">
          {r.rank} {r.name} <span className="text-muted-foreground">· {r.campName}</span>
        </p>
      )}
      <p className="text-sm">{rangeLabel(r, dayMonthYear)}</p>
      {details(r) && <p className="text-sm text-muted-foreground">{details(r)}</p>}
      {decision(r) && <p className="text-xs text-muted-foreground">{decision(r)}</p>}
    </>
  );
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {href ? (
        <Link href={href} className="flex flex-col gap-1 active:opacity-70">
          {body}
        </Link>
      ) : (
        <div className="flex flex-col gap-1">{body}</div>
      )}
      {children}
    </div>
  );
}
