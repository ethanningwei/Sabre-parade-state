"use client";

import { cn } from "cn";
import Link from "next/link";
import { useEffect, useRef } from "react";

export interface StripDay {
  date: string;
  /** "Mon", or "Today" */
  label: string;
  /** "16" */
  day: string;
  /** a camp below minimum on what's approved; else one short only if pending requests go through */
  tone: "short" | "pending" | null;
  href: string;
}

/**
 * Manpower's row of dates: tap one to see that day. A red dot is a day with a
 * camp below minimum; amber, short only if pending requests are approved.
 * Scrolls the selected day into view, so a day opened from the grid shows.
 */
export function DateStrip({ days, selected }: { days: StripDay[]; selected: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selected]);

  return (
    <nav aria-label="Days" className="-mx-4 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none]">
      {days.map((d) => {
        const on = d.date === selected;
        return (
          <Link
            key={d.date}
            ref={on ? ref : undefined}
            href={d.href}
            replace
            scroll={false}
            aria-current={on ? "date" : undefined}
            aria-label={`${d.label} ${d.day}${d.tone === "short" ? ", a camp below minimum" : d.tone === "pending" ? ", short if pending approved" : ""}`}
            className={cn(
              "tg-press flex min-h-16 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-xs",
              on ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground active:bg-muted",
            )}
          >
            <span>{d.label}</span>
            <span className={cn("text-base leading-none font-semibold tabular-nums", !on && "text-foreground")}>{d.day}</span>
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                d.tone === "short" ? "bg-destructive" : d.tone === "pending" ? "bg-amber-500" : "bg-transparent",
                on && d.tone && "ring-2 ring-primary-foreground",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
