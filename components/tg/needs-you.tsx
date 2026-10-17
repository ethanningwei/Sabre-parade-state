import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ParadeStateLink } from "@/components/tg/parade-state-tile";
import { Group } from "@/components/tg/ui";
import type { NeedLine } from "@/lib/wb/domain/needs-you";

const DOT: Record<NeedLine["kind"], string> = { short: "bg-destructive", parade: "bg-destructive", soon: "bg-amber-500", approve: "bg-muted-foreground/50" };
const ROW = "flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted";

/** Home's "Needs you": at most one line per kind of problem; nothing at all when nothing's due. */
export function NeedsYou({ lines }: { lines: readonly NeedLine[] }) {
  if (!lines.length) return null;
  return (
    <Group title="Needs you" rows className="tg-enter">
      {lines.map((l) => {
        const text = (
          <>
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[l.kind])} />
            <span className={cn("min-w-0 flex-1 text-sm leading-snug", l.kind === "short" ? "font-medium text-destructive" : "font-medium")}>{l.text}</span>
          </>
        );
        // v1's screens need a v1 sign-in first, so that one is a button
        return l.kind === "parade" ? (
          <ParadeStateLink key={l.kind} to={l.href} className={`${ROW} w-full`}>
            {text}
          </ParadeStateLink>
        ) : (
          <Link key={l.kind} href={l.href} className={ROW}>
            {text}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
          </Link>
        );
      })}
    </Group>
  );
}
