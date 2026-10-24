import { ChevronRight, CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import Link from "next/link";

/** One line of the changeover checklist: done (tick), still to do (amber), or nothing to do yet. */
export function CheckRow({ href, state, title, hint }: { href?: string; state: "done" | "todo" | "info"; title: string; hint: string }) {
  const Icon = state === "done" ? CircleCheck : state === "todo" ? CircleAlert : CircleMinus;
  const tone = state === "done" ? "text-present" : state === "todo" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  const inner = (
    <>
      <Icon className={`size-[22px] shrink-0 ${tone}`} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{title}</span>
        <span className={`text-xs leading-snug ${state === "todo" ? tone : "text-muted-foreground"}`}>{hint}</span>
      </span>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />}
    </>
  );
  const cls = "flex min-h-14 items-center gap-3 px-4 py-2.5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors duration-150 active:bg-muted`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
