import { cn } from "cn";
import Link from "next/link";
import { StateChip } from "@/components/tg/record-summary";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import type { WbRecordKind } from "@/lib/wb/domain/rules";
import { WEEKDAY_NAMES, weekdayOf } from "@/lib/wb/domain/shifts";
import { dayMonthYear } from "@/lib/wb/domain/timeline";
import type { RecordView } from "@/lib/wb/records";
import { CountUp } from "@/components/count-up";

// The parts v1's strength bars use: medical, leave and off, others; present when there's no record.
const KIND_PART: Record<WbRecordKind, "medical" | "leave" | "others"> = {
  RSI: "medical",
  RSO: "medical",
  MC: "medical",
  HL: "medical",
  STATUS: "medical",
  MA: "medical",
  AL: "leave",
  OL: "leave",
  OFF: "leave",
  EVENT: "others",
};
const BAND = { present: "bg-present/12", medical: "bg-medical/12", leave: "bg-absent/15", others: "bg-others/12" };
const DOT = { present: "bg-present", medical: "bg-medical", leave: "bg-absent", others: "bg-others" };

const label = "text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase";

/**
 * Home's Now and Next as one pass: where he stands now on a band tinted by
 * status, a perforation, then what's next and his leave left.
 */
export function StatusPass({
  current,
  next,
  campName,
  leaveLeft,
  ordDate,
  today,
}: {
  current: RecordView | null;
  next: RecordView | null;
  campName: string;
  leaveLeft: number | null;
  /** his ORD, 'YYYY-MM-DD', if he gave it at registration */
  ordDate: string | null;
  today: string;
}) {
  const toOrd = ordDate ? Math.round((Date.parse(`${ordDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null;
  const showOrd = toOrd !== null && toOrd >= 0;
  const part = current ? KIND_PART[current.kind] : "present";
  const now = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-full", DOT[part])} />
          <span className={label}>Now</span>
        </span>
        {current?.state === "PENDING" && <StateChip state={current.state} />}
      </span>
      <span className="text-[1.625rem] leading-tight font-semibold tracking-tight">{current ? KIND_LABEL[current.kind] : "Present"}</span>
      <span className="text-sm leading-snug text-muted-foreground">{current ? recordWhat(current) : `Counted present at ${campName}`}</span>
    </>
  );
  const after = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={label}>Next</span>
        <span className="leading-snug font-semibold">{next ? KIND_LABEL[next.kind] : "Nothing coming up"}</span>
        {next && <span className="text-xs leading-snug text-muted-foreground">{recordWhat(next)}</span>}
        {next?.state === "PENDING" && (
          <span className="pt-1">
            <StateChip state={next.state} />
          </span>
        )}
        {next?.state === "APPROVED" && next.deciderLabel && (
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Approved by {next.deciderLabel}</span>
        )}
      </span>
    </>
  );

  return (
    <section aria-label="Where you are" className="overflow-hidden rounded-2xl bg-card">
      {current ? (
        <Link href={`/tg/records/${current.id}`} className={cn("tg-press flex flex-col gap-1 px-4 pt-4 pb-3.5 active:opacity-80", BAND[part])}>
          {now}
        </Link>
      ) : (
        <div className={cn("flex flex-col gap-1 px-4 pt-4 pb-3.5", BAND[part])}>{now}</div>
      )}
      {/* a ticket's perforation: a dashed line with a notch cut out at each end */}
      <div aria-hidden className="relative h-0">
        <div className="mx-3.5 border-t-2 border-dashed border-border" />
        <span className="absolute top-0 -left-2.5 size-5 -translate-y-1/2 rounded-full bg-page" />
        <span className="absolute top-0 -right-2.5 size-5 -translate-y-1/2 rounded-full bg-page" />
      </div>
      {next ? (
        <Link href={`/tg/records/${next.id}`} className="flex items-center gap-3 px-4 pt-3.5 pb-4 transition-colors duration-150 active:bg-muted">
          {after}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-4 pt-3.5 pb-4">{after}</div>
      )}
      {(showOrd || leaveLeft !== null) && (
        <div className="grid auto-cols-fr grid-flow-col divide-x border-t">
          {showOrd && (
            <Stat accent value={toOrd!} label={toOrd === 0 ? "It's ORD day" : toOrd === 1 ? "day to ORD" : "days to ORD"}>
              {WEEKDAY_NAMES[weekdayOf(ordDate!)]} {dayMonthYear(ordDate!)}
            </Stat>
          )}
          {leaveLeft !== null && <Stat value={leaveLeft} label={leaveLeft === 1 ? "day of leave left" : "days of leave left"} />}
        </div>
      )}
    </section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One of the pass's numbers: big, counting up, with what it is under it. */
function Stat({ value, label, accent, children }: { value: number; label: string; accent?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 pt-3 pb-3.5">
      <CountUp value={value} className={cn("font-mono text-[1.75rem]/tight font-semibold tracking-tight tabular-nums", accent && "text-primary")} />
      <span className="text-[0.8125rem] leading-snug text-muted-foreground">{label}</span>
      {children && <span className="text-xs font-medium text-primary">{children}</span>}
    </div>
  );
}
