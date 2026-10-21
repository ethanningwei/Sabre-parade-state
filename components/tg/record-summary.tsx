import { Ban, Check, Clock, CloudUpload, Undo2, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { KIND_LABEL, recordWhat, STATE_LABEL } from "@/lib/wb/domain/describe";
import { approverOf } from "@/lib/wb/domain/access";
import { approvedOnSave, costsLeave, isLive, NO_APPROVAL_NOTE, type WbRecordState } from "@/lib/wb/domain/rules";
import { dayMonthYear, rangeLabel } from "@/lib/wb/domain/timeline";
import type { RecordView } from "@/lib/wb/records";
import { enter } from "./ui";

// One record, as a card. Server-rendered; actions are a separate client component.

// Each state has a colour and an icon, so it never rests on colour alone.
const CHIP: Record<WbRecordState, { cls: string; Icon: LucideIcon }> = {
  PENDING: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", Icon: Clock },
  APPROVED: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", Icon: Check },
  RECORDED: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", Icon: Check },
  REJECTED: { cls: "bg-destructive/10 text-destructive", Icon: X },
  CANCELLED: { cls: "bg-muted text-muted-foreground", Icon: Ban },
  WITHDRAWN: { cls: "bg-muted text-muted-foreground", Icon: Undo2 },
};

export function StateChip({ state }: { state: WbRecordState }) {
  const { cls, Icon } = CHIP[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-xs font-medium ${cls}`}>
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}

/** "ONENS upload owed": something still to do, so it stands out. */
function OnensOwed({ children = "ONENS upload owed" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <CloudUpload className="size-3" aria-hidden />
      {children}
    </span>
  );
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
    case "RSI":
      return r.reason;
    case "RSO":
      return [r.location && `@ ${r.location}`, r.reason].filter(Boolean).join(" · ");
    case "MC":
    case "HL":
      return r.mcCategory ?? "";
    case "STATUS":
      return `${r.detail} · present, on status`;
    default:
      return r.detail;
  }
}

function decision(r: RecordView): string | null {
  switch (r.state) {
    case "APPROVED":
      return approvedOnSave(r) ? NO_APPROVAL_NOTE : `Approved by ${r.deciderLabel ?? "a commander"}`;
    case "REJECTED":
      return `Rejected by ${r.deciderLabel ?? "a commander"}${r.decisionNote ? `: “${r.decisionNote}”` : ""}`;
    case "CANCELLED":
      return r.decisionNote ?? "Voided";
    case "PENDING":
      return `Waiting for ${approverOf(r.ownerRoles) ?? "your PC or PS"}`;
    default:
      return r.createdVia === "PROXY" ? "Added by a commander" : null;
  }
}

export function RecordSummary({
  r,
  showWho,
  href,
  under,
  i = 0,
  children,
}: {
  r: RecordView;
  showWho?: boolean;
  href?: string;
  /** what this visit produced (an MC and its statuses), one line each */
  under?: RecordView[];
  /** position in the list, for the stagger */
  i?: number;
  children?: React.ReactNode;
}) {
  const dead = !isLive(r.state);
  const more = details(r);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={`leading-6 font-semibold ${dead ? "text-muted-foreground" : ""}`}>{KIND_LABEL[r.kind]}</p>
        <StateChip state={r.state} />
      </div>
      {showWho && (
        <p className="text-sm">
          {r.rank} {r.name} <span className="text-muted-foreground">· {r.campName}</span>
        </p>
      )}
      <p className={`text-[0.9375rem] tabular-nums ${dead ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}>{rangeLabel(r, dayMonthYear)}</p>
      {more && <p className="text-sm text-muted-foreground">{more}</p>}
      {r.onens === "OWED" && (r.kind === "MC" || r.kind === "HL") && (
        <p>
          <OnensOwed />
        </p>
      )}
      {decision(r) && <p className="text-xs text-muted-foreground">{decision(r)}</p>}
      {!!under?.length && (
        <ul className="mt-1.5 flex flex-col gap-1 border-l-2 border-primary/30 pl-3" aria-label="What the doctor gave">
          {under.map((u) => (
            <li key={u.id} className={`text-sm ${u.state === "CANCELLED" ? "text-muted-foreground line-through" : ""}`}>
              {recordWhat(u)}
              {u.onens === "OWED" && (
                <>
                  {" "}
                  <OnensOwed>ONENS owed</OnensOwed>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <article className="tg-enter overflow-hidden rounded-2xl bg-card" style={enter(i)}>
      {href ? (
        <Link href={href} className="flex flex-col gap-1 p-4 transition-colors duration-150 active:bg-muted">
          {body}
        </Link>
      ) : (
        <div className="flex flex-col gap-1 p-4">{body}</div>
      )}
      {children && <div className="flex flex-col gap-2 px-4 pb-4 empty:hidden">{children}</div>}
    </article>
  );
}
