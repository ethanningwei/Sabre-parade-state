"use client";

import { BellRing, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { cancelConduct, nudgeCamp } from "@/lib/wb/actions/conducts";
import { toast } from "@/lib/toast";
import { ErrorBox, useAction } from "./form-bits";
import { Group } from "./ui";

// A conduct's roll-up, the parts you tap: each camp (sent, or waiting with
// Nudge), Copy coy total, and Cancel. The totals are drawn by the page.

export interface RollupCamp {
  id: string;
  campName: string;
  /** "1912H · 3SG JAYVEN", or null while waiting */
  sent: string | null;
  going: number;
  total: number;
  /** nudged in the last 10 minutes: Nudge waits */
  cooling: boolean;
  /** nobody on Sabre to DM: no GC (SC) with an account */
  noGc: boolean;
  /** the viewer may send it himself */
  sendHref: string | null;
}

export function ConductRollup({ conductId, open, camps, coyTotal }: { conductId: string; open: boolean; camps: RollupCamp[]; coyTotal: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const nudge = (c: RollupCamp) => {
    setBusy(c.id);
    call(
      () => nudgeCamp(c.id),
      (r) => {
        setBusy(null);
        if (r.sent) toast.success(`Nudged ${c.campName}'s GC`);
        else if (!r.asked) toast.error(`Nobody to nudge: ${c.campName} has no GC on Sabre.`);
        else toast.error("Telegram didn't take the DM. Call him instead.");
        router.refresh();
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Group title="Camps" rows>
        {camps.map((c) => {
          const cooling = c.cooling;
          const body = (
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{c.campName}</span>
              <span className={`text-xs ${c.sent ? "text-muted-foreground" : c.noGc ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>
                {c.sent ? `Sent ${c.sent}` : c.noGc ? "Waiting · no GC on Sabre to ask" : cooling ? "Waiting · nudged" : "Waiting"}
              </span>
            </span>
          );
          return (
            <div key={c.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              {c.sendHref ? (
                <Link href={c.sendHref} className="flex min-w-0 flex-1 items-center gap-2 active:opacity-70">
                  {body}
                  {c.sent && <span className="shrink-0 text-sm font-medium tabular-nums">{`${c.going}/${c.total}`}</span>}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                </Link>
              ) : (
                <>
                  {body}
                  {c.sent && <span className="shrink-0 text-sm font-medium tabular-nums">{`${c.going}/${c.total}`}</span>}
                </>
              )}
              {open && !c.sent && !c.noGc && (
                <Button size="lg" variant="outline" className="tg-press h-11 shrink-0 px-3.5" disabled={pending || cooling} onClick={() => nudge(c)}>
                  {busy === c.id && pending ? <Loader2 className="animate-spin" /> : <BellRing aria-hidden />}
                  Nudge
                </Button>
              )}
            </div>
          );
        })}
      </Group>
      <ErrorBox error={error} />
      <CopyButton text={coyTotal} label="Copy coy total" variant="outline" className="h-12 w-full rounded-xl text-base" />
      {open &&
        (confirming ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-card p-3">
            <p className="text-sm">Cancel it? The GCs who haven&apos;t sent are told. Posts already in Commanders of N23 stay.</p>
            <div className="flex gap-2">
              <Button size="lg" variant="outline" className="tg-press h-12 flex-1 rounded-xl" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button
                size="lg"
                variant="destructive"
                className="tg-press h-12 flex-1 rounded-xl"
                disabled={pending}
                onClick={() =>
                  call(
                    () => cancelConduct(conductId),
                    () => {
                      toast.success("Cancelled");
                      setConfirming(false);
                      router.refresh();
                    },
                  )
                }
              >
                {pending && <Loader2 className="animate-spin" />}
                Yes, cancel it
              </Button>
            </div>
          </div>
        ) : (
          <Button size="lg" variant="ghost" className="tg-press h-12 w-full rounded-xl text-destructive" onClick={() => setConfirming(true)}>
            Cancel conduct
          </Button>
        ))}
    </div>
  );
}
