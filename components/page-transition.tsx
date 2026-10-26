"use client";

import { usePathname } from "next/navigation";
import { ViewTransition } from "react";

/**
 * A soft change of screen: keyed by the path, so each navigation (a link,
 * Telegram's Back, router.back()) exits the old screen and enters the new one
 * (page-out / page-in in globals.css). Search-param changes (a tab, a day)
 * keep the key and don't animate. No View Transitions API: an instant swap.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
