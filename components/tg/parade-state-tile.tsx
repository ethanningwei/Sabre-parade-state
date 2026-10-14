"use client";

import { ChevronRight, Loader2, NotebookText } from "lucide-react";
import { useState } from "react";
import { openParadeState } from "@/lib/wb/actions/parade";
import { ErrorBox, useAction } from "./form-bits";

/**
 * "Parade state": a Tile-shaped button that signs them in to the v1 web app by
 * name, then loads it in this window. A full load, not a client navigation:
 * the v1 app has its own layout.
 */
export function ParadeStateTile() {
  const { pending, error, call } = useAction();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          call(openParadeState, () => {
            setLeaving(true);
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose (see above)
            window.location.assign("/");
          })
        }
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-muted disabled:opacity-100"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary [&_svg]:size-[18px]" aria-hidden>
          <NotebookText />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Parade state</span>
          <span className="text-xs leading-snug text-muted-foreground">{busy ? "Opening…" : "Check and send today's parade state"}</span>
        </span>
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        )}
      </button>
      {error && (
        <div className="px-3 py-2.5">
          <ErrorBox error={error} />
        </div>
      )}
    </>
  );
}
