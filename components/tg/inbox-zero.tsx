import { cn } from "cn";
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Group } from "@/components/tg/ui";
import { KIND_LABEL } from "@/lib/wb/domain/describe";
import type { RecordView } from "@/lib/wb/records";

// Bits of colour that pop out around the tick, one per status colour.
const CONFETTI = [
  "top-0 left-1 size-2 rounded-full bg-absent [animation-delay:120ms]",
  "top-3 -right-2 size-1.5 rounded-full bg-blue-500 [animation-delay:180ms]",
  "bottom-1 -left-2.5 size-1.5 rounded-full bg-medical [animation-delay:220ms]",
  "-bottom-1.5 right-1.5 size-2 rotate-12 rounded-[3px] bg-violet-500 [animation-delay:260ms]",
  "top-1/2 -right-4 size-1 rounded-full bg-present [animation-delay:300ms]",
];

const MINUTE = 60_000;

/** "40 min", "3 hours", "2 days": how long a request sat. */
function waited(ms: number): string {
  const m = Math.max(1, Math.round(ms / MINUTE));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Inbox with nothing waiting: a small reward, and what he decided today. */
export function InboxZero({ decided }: { decided: readonly RecordView[] }) {
  const longest = Math.max(0, ...decided.map((r) => (r.decidedAt ? r.decidedAt.getTime() - r.createdAt.getTime() : 0)));
  return (
    <>
      <section className="tg-enter flex flex-col items-center gap-2 rounded-2xl bg-card px-6 pt-9 pb-7 text-center" aria-live="polite">
        <span className="relative mb-2 flex size-24 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-present/15" />
          <span className="tg-pop relative flex size-17 items-center justify-center rounded-full bg-present text-white">
            <Check className="size-9" strokeWidth={2.75} />
          </span>
          {CONFETTI.map((c) => (
            <span key={c} className={cn("tg-pop absolute", c)} />
          ))}
        </span>
        <h2 className="text-[1.375rem] font-semibold tracking-tight">All caught up</h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          {decided.length ? (
            <>
              You decided {decided.length} {decided.length === 1 ? "request" : "requests"} today.
              <br />
              The longest anyone waited was {waited(longest)}.
            </>
          ) : (
            "Nothing is waiting on you."
          )}
        </p>
      </section>
      {decided.length > 0 && (
        <Group title="Decided today" rows className="tg-enter">
          {decided.map((r) => (
            <Link key={r.id} href={`/tg/records/${r.id}`} className="flex min-h-13 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">
                  {r.rank} {r.name}
                </span>{" "}
                <span className="text-muted-foreground">· {KIND_LABEL[r.kind]}</span>
              </span>
              <span className={cn("text-xs font-semibold", r.state === "REJECTED" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                {r.state === "REJECTED" ? "Rejected" : "Approved"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
            </Link>
          ))}
        </Group>
      )}
    </>
  );
}
