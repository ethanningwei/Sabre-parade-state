import { Lock } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { recordWhat } from "@/lib/wb/domain/describe";
import type { RecordView } from "@/lib/wb/records";
import { OnensButton } from "./onens-button";

// What the doctor gave, on a record's page. The diagnosis and photo are passed
// in only for someone allowed to see them (the page read them through
// lib/wb/medical.ts, which audited it); the photo loads from the audited
// file route. Server-rendered.

export function VisitSection({
  outcome,
  answered,
  diagnoses,
  photoId,
  outcomeHref,
  canMarkOnens,
  own,
}: {
  outcome: RecordView[];
  /** an outcome (or "nothing given") is in */
  answered: boolean;
  diagnoses: Map<string, string> | null;
  /** a record whose photo the viewer may load, or null */
  photoId: string | null;
  /** the trooper's own Update/Correct link; null for anyone else */
  outcomeHref: string | null;
  canMarkOnens: boolean;
  /** the trooper looking at his own */
  own: boolean;
}) {
  const owed = outcome.find((r) => r.onens === "OWED");
  const done = outcome.find((r) => r.onens === "DONE");
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="font-medium">What the doctor gave</p>
      {outcome.length === 0 ? (
        <p className="text-sm text-muted-foreground">{answered ? "Nothing: no MC and no status." : "Not recorded yet."}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {outcome.map((r) => (
            <li key={r.id} className="flex flex-col">
              <span>{recordWhat(r)}</span>
              {r.kind === "STATUS" && <span className="text-xs text-muted-foreground">Present, on status</span>}
              {diagnoses?.get(r.id) && (
                <span className="mt-1 flex items-center gap-1.5 text-xs">
                  <Lock className="size-3 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="text-muted-foreground">Diagnosis: </span>
                    {diagnoses.get(r.id)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {owed && <p className="text-sm">☁️ Still to upload to ONENS</p>}
      {!owed && done && <p className="text-sm text-muted-foreground">☁️ Uploaded to ONENS</p>}
      {photoId && (
        <a href={`/api/wb/file/${photoId}`} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed from Telegram through an audited, no-store route */}
          <img src={`/api/wb/file/${photoId}`} alt="The medical document" loading="lazy" className="max-h-80 w-full rounded-lg border object-contain" />
        </a>
      )}
      {(diagnoses?.size || photoId) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3 shrink-0" />
          {own ? "Only you, your PC and PS, and OC, 2IC and CSM see this." : "Only he, his PC and PS, and OC, 2IC and CSM see this."} Each look is logged.
        </p>
      )}
      {owed && canMarkOnens && <OnensButton recordId={owed.id} />}
      {outcomeHref && (
        <Link href={outcomeHref} className={buttonVariants({ size: "lg", variant: answered ? "outline" : "default", className: "h-11" })}>
          {answered ? "✏️ Correct the outcome" : "💊 Update outcome"}
        </Link>
      )}
    </section>
  );
}
