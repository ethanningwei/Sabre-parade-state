import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Group } from "@/components/tg/ui";
import type { NeedLine } from "@/lib/wb/domain/needs-you";

const DOT: Record<NeedLine["kind"], string> = { short: "bg-destructive", soon: "bg-amber-500", approve: "bg-muted-foreground/50" };

/** Home's "Needs you": at most one line per kind of problem; nothing at all when nothing's due. */
export function NeedsYou({ lines }: { lines: readonly NeedLine[] }) {
  if (!lines.length) return null;
  return (
    <Group title="Needs you" rows className="tg-enter">
      {lines.map((l) => (
        <Link key={l.kind} href={l.href} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[l.kind])} />
          <span className={cn("min-w-0 flex-1 text-sm leading-snug", l.kind === "short" ? "font-medium text-destructive" : "font-medium")}>{l.text}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        </Link>
      ))}
    </Group>
  );
}
