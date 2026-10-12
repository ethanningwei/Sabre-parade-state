import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** A full-width row linking to a Mini App screen. */
export function Tile({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 active:bg-muted">
      <span className="text-muted-foreground [&_svg]:size-5">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}
