"use client";

import { ClipboardList, History, LayoutGrid, Settings, Shield, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BottomNav({ isAdmin, homeSubunitId }: { isAdmin: boolean; homeSubunitId: string | null }) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Overview", icon: LayoutGrid, match: (p: string) => p === "/" },
    ...(homeSubunitId
      ? [{ href: `/s/${homeSubunitId}`, label: "Platoon", icon: Users, match: (p: string) => p.startsWith("/s/") || p.startsWith("/c/") }]
      : []),
    { href: "/duties", label: "Duties", icon: Shield, match: (p: string) => p.startsWith("/duties") },
    { href: "/parade", label: "Parade", icon: ClipboardList, match: (p: string) => p.startsWith("/parade") },
    { href: "/history", label: "History", icon: History, match: (p: string) => p.startsWith("/history") },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Settings, match: (p: string) => p.startsWith("/admin") }] : []),
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-page/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <ul className="mx-auto flex h-16 max-w-2xl items-stretch justify-around px-2">
        {items.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.25]")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
