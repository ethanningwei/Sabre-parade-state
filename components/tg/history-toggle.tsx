import { ChevronRight, History } from "lucide-react";
import Link from "next/link";

// The foot of My records and Person history: what's current by default, with
// everything one tap away. A plain link with ?all=1, so it's server-rendered
// and Back returns to the current view.

export function HistoryToggle({ href, all, count }: { href: string; all: boolean; count: number }) {
  if (!all && count === 0) return null;
  return (
    <Link
      href={all ? href : `${href}?all=1`}
      className="tg-press flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium text-primary active:bg-muted"
    >
      <History className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{all ? "Current only" : `Full history (${count})`}</span>
      <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}
