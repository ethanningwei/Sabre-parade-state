"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/shared";
import { webApp } from "./webapp";

// Pieces every Mini App form shares. Inputs are 16px (text-base) so iOS
// doesn't zoom on focus; tap targets are at least 44px.

export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
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

export function ErrorBox({ error }: { error: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // on a phone the message is often below the fold, under the keyboard
  useEffect(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }), [error]);
  if (!error) return null;
  return (
    <p ref={ref} role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

export function Submit({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="h-11" disabled={pending || disabled}>
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
    <Button type="button" size="lg" variant={variant} className="h-11" onClick={onClick} disabled={pending || disabled}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function Header({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </header>
  );
}

/** "You already have something on those days". Never a refusal. */
export function ClashStep({ lines, onCarryOn, onChange }: { lines: string[]; onCarryOn: () => void; onChange: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-600" /> You already have something on those days
        </p>
        <ul className="list-disc pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          If that&apos;s deliberate, carry on and your commander will see both. If the dates are wrong, now is the cheapest moment to fix them.
        </p>
      </div>
      <BigButton onClick={onCarryOn}>Carry on</BigButton>
      <BigButton variant="outline" onClick={onChange}>
        ↩ Change the dates
      </BigButton>
    </section>
  );
}

export type Delivery = "sent" | "no-chat" | "failed" | null;

/** After saving: where it went, and where to go next. */
export function Done({ title, delivery, subunitName, needsApproval }: { title: string; delivery: Delivery; subunitName: string; needsApproval: boolean }) {
  const line =
    delivery === "no-chat"
      ? `Saved, but ${subunitName} has no commanders chat yet. Ask your PC to send /here in it.`
      : delivery === "failed"
        ? "Saved, but I couldn't post it to your commanders' chat. They can still see it in Sabre."
        : needsApproval
          ? `Sent to your ${subunitName} commanders. You'll get a message when they decide.`
          : `Your ${subunitName} commanders can see it.`;
  return (
    <section className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircle2 className="size-12 text-emerald-600" />
      <h2 className="text-xl font-semibold">{delivery === "no-chat" || delivery === "failed" ? "Saved" : title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{line}</p>
      <div className="mt-2 flex w-full flex-col gap-2">
        <Link href="/tg/records" className={buttonVariants({ size: "lg", className: "h-11" })}>
          My records
        </Link>
        <Link href="/tg" className={buttonVariants({ size: "lg", variant: "outline", className: "h-11" })}>
          Home
        </Link>
      </div>
    </section>
  );
}

/** "HH:MM" from a time input -> "HHMM"; the actions accept either. */
export const hhmm = (t: string) => t.replace(":", "");
