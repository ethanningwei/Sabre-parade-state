"use client";

import { Check, UserMinus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { removeFromRosterAction } from "@/lib/wb/actions/roster";
import { removalLines, type RemovalCounts } from "@/lib/wb/domain/roster-flow";
import { BigButton, ErrorBox, useAction } from "../form-bits";
import { TgSheet } from "./tg-sheet";

/** Person history's Remove from roster: what it will do, counted, then one confirm. `after`: where to go once he's gone. */
export function RemoveFromRoster({ personId, name, counts, after = "/tg/people" }: { personId: string; name: string; counts: RemovalCounts; after?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, call } = useAction();
  const { will, keeps } = removalLines(counts);

  const remove = () =>
    call(
      () => removeFromRosterAction(personId),
      () => {
        toast.success(`${name} is off the roster`);
        setOpen(false);
        router.replace(after);
      },
    );

  return (
    <>
      <BigButton variant="outline" onClick={() => setOpen(true)}>
        <UserMinus aria-hidden /> Remove from roster
      </BigButton>
      <TgSheet open={open} onOpenChange={setOpen} title={`Remove ${name}?`} description="For ORD, posting out, or anyone who shouldn't be on the parade state any more.">
        <section className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">This will</p>
          <ul className="tg-rows overflow-hidden rounded-2xl bg-card">
            {will.map((line) => (
              <li key={line} className="flex gap-2.5 px-4 py-3 text-sm">
                <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">It keeps</p>
          <ul className="tg-rows overflow-hidden rounded-2xl bg-card">
            {keeps.map((line) => (
              <li key={line} className="flex gap-2.5 px-4 py-3 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </section>
        <ErrorBox error={error} />
        <div className="grid grid-cols-2 gap-2">
          <BigButton variant="destructive" pending={pending} onClick={remove}>
            Remove
          </BigButton>
          <BigButton variant="outline" onClick={() => setOpen(false)}>
            Back
          </BigButton>
        </div>
      </TgSheet>
    </>
  );
}
