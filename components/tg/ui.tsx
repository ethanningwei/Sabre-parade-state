import { cn } from "cn";
import Link from "next/link";

// Layout pieces every Mini App screen shares: a group with a small heading
// (Telegram's settings style), an empty state, and a skeleton block.
// Server-safe: no hooks, no client code.

// Class strings live here, not in form-bits: anything a "use client" file
// exports reaches a server component as a client reference, not a string.
export const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";
/** For the shared Input. */
export const fieldClass = "h-12 rounded-xl bg-card px-3 text-base md:text-base dark:bg-card";
/** For the shared Textarea. */
export const textareaClass = "min-h-24 rounded-xl bg-card px-3 py-2.5 text-base md:text-base dark:bg-card";
/** A full-width action: 48px tall, presses in. */
export const bigButtonClass = "tg-press h-12 w-full rounded-xl text-base";

/** Stagger index for .tg-enter (miniapp.css caps the delay). */
export const enter = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** A titled group. `rows` joins its children into one card with hairlines between them. */
export function Group({
  title,
  aside,
  hint,
  rows,
  className,
  children,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  hint?: React.ReactNode;
  rows?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-2 px-1">
          {title && <h2 className="text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>}
          {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
        </div>
      )}
      {rows ? <div className="tg-rows overflow-hidden rounded-2xl bg-card">{children}</div> : <div className="flex flex-col gap-2.5">{children}</div>}
      {hint && <p className="px-1 text-xs text-muted-foreground">{hint}</p>}
    </section>
  );
}

/**
 * Two or three views of one screen, as links (server-rendered, so each view is
 * its own URL). `replace`: Back leaves the screen, not the last tab.
 */
export function Segmented({ items, label }: { items: { href: string; label: string; count?: number; on: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl bg-muted p-0.5">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          replace
          aria-current={t.on ? "page" : undefined}
          className={cn(
            "flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] px-2 text-sm font-medium transition-colors duration-150",
            t.on ? "bg-card text-foreground shadow-xs" : "text-muted-foreground active:bg-card/60",
          )}
        >
          {t.label}
          {!!t.count && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", t.on ? "bg-primary text-primary-foreground" : "bg-card")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Nothing to show: an icon, a sentence, and where to go instead. */
export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="tg-enter flex flex-col items-center gap-2 rounded-2xl bg-card px-5 py-8 text-center">
      <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6" aria-hidden>
        {icon}
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="flex w-full flex-col items-center gap-3 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A grey placeholder bar for loading.tsx. */
export function Bone({ className }: { className?: string }) {
  return <div className={cn("tg-skeleton rounded-md bg-muted", className)} />;
}

/** A placeholder for a record card. */
export function CardBone() {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-card p-4">
      <div className="flex items-center justify-between">
        <Bone className="h-5 w-32" />
        <Bone className="h-5 w-16 rounded-full" />
      </div>
      <Bone className="h-4 w-40" />
      <Bone className="h-3.5 w-56" />
    </div>
  );
}

/** A page placeholder: a title and some cards. */
export function PageBone({ cards = 3 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <Bone className="h-7 w-44" />
        <Bone className="h-4 w-56" />
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <CardBone key={i} />
      ))}
    </div>
  );
}
