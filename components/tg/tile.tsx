import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** A row linking to a Mini App screen, for a Group with `rows` (Telegram's settings style). */
export function Tile({ href, icon, title, hint, badge }: { href: string; icon: React.ReactNode; title: string; hint?: string; badge?: number }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary [&_svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
      {!!badge && (
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground tabular-nums" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}
