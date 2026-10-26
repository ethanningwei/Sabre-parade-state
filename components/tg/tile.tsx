import { ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Solid icon squares, one colour per screen, as Telegram's and iOS's settings
 * lists: men find a screen by its colour. White icons; each passes 3:1.
 */
export const TILE_TONE = {
  blue: "bg-blue-500 text-white",
  indigo: "bg-indigo-500 text-white",
  violet: "bg-violet-500 text-white",
  pink: "bg-pink-500 text-white",
  red: "bg-red-500 text-white",
  orange: "bg-orange-600 text-white",
  green: "bg-emerald-600 text-white",
  teal: "bg-teal-600 text-white",
  slate: "bg-slate-500 text-white",
} as const;
export type TileTone = keyof typeof TILE_TONE;
/** No tone: the primary tint every other list uses. */
export const tileIconClass = (tone?: TileTone) =>
  `flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px] ${tone ? TILE_TONE[tone] : "bg-primary/12 text-primary"}`;

/** A row linking to a Mini App screen, for a Group with `rows` (Telegram's settings style). */
export function Tile({
  href,
  icon,
  title,
  hint,
  badge,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint?: string;
  badge?: number;
  tone?: TileTone;
}) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
      <span className={tileIconClass(tone)} aria-hidden>
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
