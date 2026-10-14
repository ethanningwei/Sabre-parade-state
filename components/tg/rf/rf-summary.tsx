import { Ban, Bus, CircleCheck, Hourglass, TimerOff } from "lucide-react";
import Link from "next/link";
import { isOver, shortBy, wants, type RfRequestView } from "@/lib/wb/domain/rf";
import { rangeLabel } from "@/lib/wb/domain/timeline";
import { enter } from "../ui";

// One RF request as a card: the camp, when, what it wants, why, who's been
// sent and what's still short. Server-safe: used by the board and a request's page.

const CHIP = {
  OPEN: { label: "Open", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", Icon: Hourglass },
  FILLED: { label: "Filled", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", Icon: CircleCheck },
  CLOSED: { label: "Closed", cls: "bg-muted text-muted-foreground", Icon: Ban },
  EXPIRED: { label: "Expired", cls: "bg-muted text-muted-foreground", Icon: TimerOff },
  OVER: { label: "Over", cls: "bg-muted text-muted-foreground", Icon: TimerOff },
} as const;

export function RfChip({ r, now }: { r: RfRequestView; now: Date }) {
  const { label, cls, Icon } = CHIP[r.state === "OPEN" && isOver(r, now) ? "OVER" : r.state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-xs font-medium ${cls}`}>
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {label}
    </span>
  );
}

/** "Still short 1 of 2", "Filled · 2 of 2", "Closed · 1 of 2 sent". */
export function shortLine(r: RfRequestView): string {
  if (r.state === "FILLED") return `Filled · ${r.deployed.length} of ${r.need}`;
  if (r.state === "CLOSED") return `Closed${r.closedBy ? ` by ${r.closedBy}` : ""} · ${r.deployed.length} of ${r.need} sent`;
  if (r.state === "EXPIRED") return `Expired unfilled · ${r.deployed.length} of ${r.need} sent`;
  return `Still short ${shortBy(r)} of ${r.need}`;
}

export function RfSummary({ r, now, href, i = 0, children }: { r: RfRequestView; now: Date; href?: string; i?: number; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary" aria-hidden>
            <Bus className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h3 className="leading-snug font-semibold">
              {r.campName} <span className="font-normal text-muted-foreground">· {r.subunitName}</span>
            </h3>
            <p className="text-sm text-muted-foreground">{rangeLabel(r)}</p>
          </div>
        </div>
        <RfChip r={r} now={now} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Wants</dt>
        <dd className="font-medium">{wants(r)}</dd>
        <dt className="text-muted-foreground">Why</dt>
        <dd>{r.reason}</dd>
        {r.deployed.length > 0 && (
          <>
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{r.deployed.map((d) => `${d.rank} ${d.name} (${d.campName})`).join(", ")}</dd>
          </>
        )}
      </dl>
      <p className={`text-sm ${r.state === "OPEN" && !isOver(r, now) ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{shortLine(r)}</p>
      <p className="text-xs text-muted-foreground">Asked by {r.raisedBy}</p>
    </>
  );
  return (
    <article className="tg-enter flex flex-col rounded-2xl bg-card" style={enter(i)}>
      {href ? (
        <Link href={href} className="flex flex-col gap-3 rounded-2xl p-4 transition-colors duration-150 active:bg-muted">
          {body}
        </Link>
      ) : (
        <div className="flex flex-col gap-3 p-4">{body}</div>
      )}
      {children && <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>}
    </article>
  );
}
