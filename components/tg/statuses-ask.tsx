"use client";

import { FileHeart } from "lucide-react";
import { useRouter } from "next/navigation";
import { noStatuses } from "@/lib/wb/actions/medical";
import { BigButton, BigLink, ErrorBox, useAction } from "./form-bits";

/**
 * Home, until he answers (2026-10-27): statuses he had before Sabre, so his
 * commanders see them. Everyone registered before registration asked.
 */
export function StatusesAsk() {
  const router = useRouter();
  const { pending, error, call } = useAction();
  return (
    <section className="tg-enter flex flex-col gap-3 rounded-2xl bg-card p-4">
      <div className="flex items-start gap-3">
        <FileHeart className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">Any statuses from before Sabre?</p>
          <p className="text-sm text-muted-foreground">Add any you still have, permanent or temporary, so your commanders see them.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <BigLink href="/tg/statuses/declare">Add them</BigLink>
        <BigButton variant="outline" pending={pending} onClick={() => call(noStatuses, () => router.refresh())}>
          None
        </BigButton>
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
