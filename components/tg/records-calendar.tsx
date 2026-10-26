import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { isLive, type WbRecordKind } from "@/lib/wb/domain/rules";
import { weekdayOf } from "@/lib/wb/domain/shifts";
import { addDays, touchesDay } from "@/lib/wb/domain/timeline";
import type { RecordView } from "@/lib/wb/records";

type Part = "medical" | "leave" | "others";

// As the pass and v1's strength bars: medical, leave and off, others.
const KIND_PART: Record<WbRecordKind, Part> = {
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
// a day with several records shows the one that matters most
const RANK: Record<Part, number> = { medical: 0, leave: 1, others: 2 };
const FILL: Record<Part, string> = { medical: "bg-medical/25", leave: "bg-absent/30", others: "bg-others/25" };
const DASH: Record<Part, string> = { medical: "border-medical", leave: "border-absent", others: "border-others" };
const SWATCH: Record<Part, string> = { medical: "bg-medical", leave: "bg-absent", others: "bg-others" };
const LABEL: Record<Part, string> = { leave: "Leave and off", medical: "Medical", others: "Others" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 'YYYY-MM' plus n months. */
function addMonths(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * My records as a month: each day tinted by what he was away for (absent
 * records only; a pending one is a dashed outline), today ringed, a day opens
 * its record. `href(month)` builds the link to another month.
 */
export function RecordsCalendar({ records, month, today, href }: { records: readonly RecordView[]; month: string; today: string; href: (month: string) => string }) {
  const away = records.filter((r) => r.absent && isLive(r.state));
  const first = `${month}-01`;
  const days = Array.from({ length: daysIn(month) }, (_, i) => addDays(first, i));
  const cells = days.map((date) => {
    const r = away.filter((x) => touchesDay(x, date)).sort((a, b) => RANK[KIND_PART[a.kind]] - RANK[KIND_PART[b.kind]] || Number(a.state === "PENDING") - Number(b.state === "PENDING"))[0];
    return { date, r, part: r ? KIND_PART[r.kind] : null };
  });
  const shown = (["leave", "medical", "others"] as const).filter((p) => cells.some((c) => c.part === p));
  // whole days away, as approved (a pending day isn't counted yet)
  const tally = (["medical", "leave", "others"] as const)
    .map((p) => [p, cells.filter((c) => c.part === p && c.r?.state !== "PENDING").length] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${n} day${n === 1 ? "" : "s"} ${p === "leave" ? "leave or off" : p === "medical" ? "medical" : "other"}`);
  const summary = tally.length ? tally.join(" · ") : "Nothing this month";

  return (
    <section aria-label={`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`} className="tg-enter flex flex-col gap-2.5 rounded-2xl bg-card px-3 pt-3 pb-4">
      <div className="flex items-center justify-between">
        <Link href={href(addMonths(month, -1))} replace scroll={false} aria-label="Month before" className="tg-press flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-semibold">
            {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
          </span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
        <Link href={href(addMonths(month, 1))} replace scroll={false} aria-label="Month after" className="tg-press flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-7 text-center text-[0.6875rem] font-semibold text-muted-foreground" aria-hidden>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1.5">
        {Array.from({ length: weekdayOf(first) }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {cells.map(({ date, r, part }) => {
          const pending = r?.state === "PENDING";
          const cls = cn(
            "mx-auto flex size-10 items-center justify-center rounded-xl text-sm tabular-nums",
            part && !pending && cn(FILL[part], "font-semibold"),
            part && pending && cn("border-2 border-dashed font-semibold", DASH[part]),
            !part && date < today && "text-muted-foreground",
            date === today && "ring-2 ring-primary ring-inset font-bold text-primary",
          );
          const n = Number(date.slice(8));
          return r ? (
            <Link key={date} href={`/tg/records/${r.id}`} className={cn(cls, "tg-press")} aria-label={`${n}: ${r.kind}${pending ? ", pending" : ""}`}>
              {n}
            </Link>
          ) : (
            <span key={date} className={cls}>
              {n}
            </span>
          );
        })}
      </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 px-1 pt-1 text-xs text-muted-foreground">
          {shown.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", SWATCH[p])} aria-hidden />
              {LABEL[p]}
            </span>
          ))}
          {cells.some((c) => c.r?.state === "PENDING") && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] border-2 border-dashed border-muted-foreground" aria-hidden />
              Pending
            </span>
          )}
        </div>
      )}
    </section>
  );
}
