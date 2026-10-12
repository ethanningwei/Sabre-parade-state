"use client";

import { AlertTriangle, Check, ChevronLeft, CircleAlert, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/shared";
import { bigButtonClass } from "./ui";
import { tick, webApp } from "./webapp";

export { bigButtonClass, fieldClass, inputClass, textareaClass } from "./ui";

// Pieces every Mini App form shares. Inputs are 16px (text-base) so iOS
// doesn't zoom on focus; tap targets are at least 44px (most are 48).

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="leading-snug">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A server action call with a pending state, an error message and haptics. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = <T,>(fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        webApp()?.HapticFeedback?.notificationOccurred("error");
        return;
      }
      webApp()?.HapticFeedback?.notificationOccurred("success");
      onOk(res.data);
    });
  return { pending, error, setError, call };
}

const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ErrorBox({ error }: { error: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // on a phone the message is often below the fold, under the keyboard
  // braces: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
  }, [error]);
  if (!error) return null;
  return (
    <p ref={ref} role="alert" className="tg-reveal flex gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  );
}

export function Submit({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className={bigButtonClass} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function BigButton({
  onClick,
  variant = "default",
  pending,
  disabled,
  children,
}: {
  onClick: () => void;
  variant?: "default" | "outline" | "destructive" | "secondary";
  pending?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" size="lg" variant={variant} className={bigButtonClass} onClick={onClick} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function Header({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-1 px-1">
      <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance">{title}</h1>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </header>
  );
}

/**
 * Where he is in a form of several screens: "Step 2 of 4 · Which days", a bar,
 * and Back to the step before (his answers are kept).
 */
export function StepBar({ at, of, label, onBack }: { at: number; of: number; label: string; onBack?: () => void }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex min-h-11 items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className="tg-press -ml-2 flex min-h-11 items-center gap-0.5 rounded-lg pr-2 pl-1 text-sm font-medium text-primary active:bg-muted">
            <ChevronLeft className="size-4" aria-hidden /> Back
          </button>
        )}
        <p className="ml-auto text-xs font-medium text-muted-foreground" aria-live="polite">
          Step {at} of {of} · {label}
        </p>
      </div>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i < at ? "bg-primary" : "bg-muted-foreground/20"}`} />
        ))}
      </div>
    </div>
  );
}

/** One numbered part of a long form, so it reads as steps. */
export function Step({ n, title, hint, children }: { n: number; title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="tg-reveal flex flex-col gap-3" aria-label={title}>
      <div className="flex items-start gap-2.5 px-1">
        <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary tabular-nums" aria-hidden>
          {n}
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold leading-6">{title}</h2>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** "You already have something on those days". Never a refusal. */
export function ClashStep({ lines, onCarryOn, onChange }: { lines: string[]; onCarryOn: () => void; onChange: () => void }) {
  return (
    <section className="tg-reveal flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden /> You already have something on those days
        </p>
        <ul className="list-disc pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          If that&apos;s deliberate, carry on and your commander will see both. If the dates are wrong, now is the cheapest moment to fix them.
        </p>
      </div>
      <BigButton onClick={onCarryOn}>Carry on</BigButton>
      <BigButton variant="outline" onClick={onChange}>
        <Undo2 aria-hidden /> Change the dates
      </BigButton>
    </section>
  );
}

export type Delivery = "sent" | "no-chat" | "failed" | null;

/** The end of a form: a tick, what happened, and where to go next. */
export function DoneScreen({
  title,
  line,
  tone = "ok",
  note,
  children,
}: {
  title: string;
  line: React.ReactNode;
  /** "warn" when it saved but didn't reach the chat */
  tone?: "ok" | "warn";
  /** one more thing he must do, in a callout */
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="tg-enter flex flex-col items-center gap-3 pt-8 pb-2 text-center" aria-live="polite">
      <span
        className={`tg-pop flex size-16 items-center justify-center rounded-full ${tone === "ok" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}
        aria-hidden
      >
        {tone === "ok" ? <Check className="size-8" strokeWidth={2.5} /> : <AlertTriangle className="size-7" />}
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{line}</p>
      {note && <p className="w-full rounded-xl bg-card px-4 py-3 text-sm font-medium">{note}</p>}
      <div className="mt-3 flex w-full flex-col gap-2">{children}</div>
    </section>
  );
}

/** A link styled as a big button, for the Done screens. */
export function BigLink({ href, outline, children }: { href: string; outline?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonVariants({ size: "lg", variant: outline ? "outline" : "default", className: bigButtonClass })}>
      {children}
    </Link>
  );
}

/** After saving: where it went, and where to go next. */
export function Done({
  title,
  delivery,
  subunitName,
  needsApproval,
  note,
}: {
  title: string;
  delivery: Delivery;
  subunitName: string;
  needsApproval: boolean;
  note?: React.ReactNode;
}) {
  const line =
    delivery === "no-chat"
      ? `Saved, but ${subunitName} has no commanders chat yet. Ask your PC to send /here in it.`
      : delivery === "failed"
        ? "Saved, but I couldn't post it to your commanders' chat. They can still see it in Sabre."
        : needsApproval
          ? `Sent to your ${subunitName} commanders. You'll get a message when they decide.`
          : `Your ${subunitName} commanders can see it.`;
  const short = delivery === "no-chat" || delivery === "failed";
  return (
    <DoneScreen title={short ? "Saved" : title} line={line} tone={short ? "warn" : "ok"} note={note}>
      <BigLink href="/tg/records">My records</BigLink>
      <BigLink href="/tg" outline>
        Home
      </BigLink>
    </DoneScreen>
  );
}

/** "HH:MM" from a time input -> "HHMM"; the actions accept either. */
export const hhmm = (t: string) => t.replace(":", "");

/** One answer of several, as a big tappable row (Sabre Bot's buttons). */
export function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!on) tick();
        onClick();
      }}
      aria-pressed={on}
      className={`tg-press flex min-h-12 items-center gap-2 rounded-xl border px-3.5 text-left ${on ? "border-primary bg-primary/10 font-medium" : "border-border bg-card active:bg-muted"}`}
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {on && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

/** A yes/no question answered with two big buttons. */
export function YesNo({ label, value, onChange, yes = "Yes", no = "No" }: { label: string; value: boolean | null; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-2 gap-2">
        <Choice on={value === true} onClick={() => onChange(true)}>
          {yes}
        </Choice>
        <Choice on={value === false} onClick={() => onChange(false)}>
          {no}
        </Choice>
      </div>
    </Field>
  );
}
