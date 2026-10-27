import { cn } from "cn";
import { ChevronRight, FileText, Hourglass, Plus } from "lucide-react";
import Link from "next/link";
import type { StatusItem } from "@/lib/wb/domain/statuses";
import { dayMonth, dayMonthYear } from "@/lib/wb/domain/timeline";
import { enter } from "./ui";

// A man's statuses on his own pages (Person history, My records), apart from
// his other records: a list down a medical strip, not a stack of cards. A row
// opens the record, where Void, the photo and Correct are. Server-rendered.

/** "since 12/03/25", "until 03/11 · 7 days left", "from 01/11 until 03/11", "03/10–10/10" once it's over. */
function when(s: StatusItem, over: boolean): string {
  if (s.permanent) return `since ${dayMonthYear(s.from)}`;
  if (over) return s.from === s.until ? dayMonth(s.from) : `${dayMonth(s.from)}–${dayMonth(s.until!)}`;
  if (s.upcoming) return `from ${dayMonth(s.from)} until ${dayMonth(s.until!)}`;
  const left = s.daysLeft === 0 ? "ends today" : s.daysLeft === 1 ? "ends tomorrow" : `${s.daysLeft} days left`;
  return s.daysLeft === 0 ? left : `until ${dayMonth(s.until!)} · ${left}`;
}

function Row({ s, photo, over = false }: { s: StatusItem; photo: boolean; over?: boolean }) {
  return (
    <Link href={`/tg/records/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", over && "text-muted-foreground")}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-semibold", s.voided && "line-through decoration-muted-foreground/50")}>{s.label}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", over ? "bg-muted text-muted-foreground" : "bg-medical/12 text-medical")}>{s.permanent ? "Permanent" : "Temporary"}</span>
          {s.voided && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Voided</span>}
          {photo && <FileText className="size-4 text-muted-foreground" aria-label="Paper attached" />}
        </span>
        <span className={cn("flex items-center gap-1 text-[0.9375rem] tabular-nums", s.endsSoon ? "font-medium text-amber-700 dark:text-amber-400" : !over && "text-foreground")}>
          {s.endsSoon && <Hourglass className="size-3.5 shrink-0" aria-hidden />}
          {when(s, over)}
        </span>
        <span className="text-xs text-muted-foreground">{s.source}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}

export function StatusesPanel({
  live,
  past,
  photos,
  addHref,
  i = 0,
}: {
  live: StatusItem[];
  past: StatusItem[];
  /** the ones with a paper, for the viewer allowed to know (lib/wb/medical.ts photoIds) */
  photos: ReadonlySet<string>;
  /** My records: "Add a status you already have" */
  addHref?: string;
  i?: number;
}) {
  return (
    <section className="tg-enter flex flex-col gap-1.5" style={enter(i)} aria-label="Statuses">
      <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Statuses · {live.length}</h2>
      <div className="relative overflow-hidden rounded-2xl bg-card pl-1">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-medical" />
        <div className="tg-rows">
          {live.length === 0 && <p className="flex min-h-12 items-center px-4 text-[0.9375rem] text-muted-foreground">No statuses</p>}
          {live.map((s) => (
            <Row key={s.id} s={s} photo={photos.has(s.id)} />
          ))}
          {addHref && (
            <Link href={addHref} className="flex min-h-12 items-center gap-2 px-4 py-2 text-[0.9375rem] font-medium text-primary transition-colors duration-150 active:bg-muted">
              <Plus className="size-4 shrink-0" aria-hidden />
              Add a status you already have
            </Link>
          )}
        </div>
      </div>
      {past.length > 0 && (
        <details className="group overflow-hidden rounded-2xl bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 active:bg-muted [&::-webkit-details-marker]:hidden">
            Past statuses ({past.length})
            <ChevronRight className="size-4 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="tg-rows border-t">
            {past.map((s) => (
              <Row key={s.id} s={s} photo={photos.has(s.id)} over />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
