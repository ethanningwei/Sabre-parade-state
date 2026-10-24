import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import type { Reported } from "@/lib/wb/actions/records";
import type { ReportedItem } from "@/lib/wb/report-for";
import { BigLink, DoneScreen } from "../form-bits";

// Report for your men (2026-10-24): the bits the sick and MA forms share when
// a commander reports for one of his men, and when the man finds it already
// reported for him.

/** On his own form: someone reported this day already, so he opens that one instead. */
export function AlreadyReported({ r }: { r: ReportedItem }) {
  return (
    <section className="tg-reveal flex flex-col gap-3 rounded-2xl bg-card p-4" aria-live="polite">
      <p className="font-medium">{r.by} already reported this</p>
      <p className="text-sm text-muted-foreground">Open it to see where it stands, record what the doctor gave you, or say it&apos;s not right.</p>
      <BigLink href={`/tg/records/${r.id}`}>Open it</BigLink>
    </section>
  );
}

/** The way into reporting for a man, above a member's own form. */
export function ForManLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex min-h-13 items-center gap-3 rounded-2xl bg-card px-4 py-2 transition-colors duration-150 active:bg-muted">
      <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}

/** After reporting for him: where the card went, and that he's been told. */
export function ReportedDone({ result, title }: { result: Reported; title: string }) {
  const line =
    result.delivery === "no-chat"
      ? `Saved, but ${result.subunitName} has no commanders chat yet, so no card went out.`
      : result.delivery === "failed"
        ? "Saved, but I couldn't post the card. His commanders can still see it in Sabre."
        : `The card is in ${result.subunitName}'s commanders chat.`;
  return (
    <DoneScreen title={title} line={line} tone={result.delivery === "sent" ? "ok" : "warn"} note={`${result.who} gets a message if he's on Sabre, and can say it's not right.`}>
      <BigLink href={`/tg/records/${result.recordId}`}>Open it</BigLink>
      <BigLink href="/tg" outline>
        Home
      </BigLink>
    </DoneScreen>
  );
}
