"use client";

import { ChevronRight, Loader2, NotebookText } from "lucide-react";
import { useState } from "react";
import { openParadeState } from "@/lib/wb/actions/parade";
import { ErrorBox, useAction } from "./form-bits";

/**
 * Signs them in to the v1 web app by name, then loads `to` (a v1 screen) in
 * this window. A full load, not a client navigation: the v1 app has its own layout.
 */
function useOpenParadeState(to: string) {
  const { pending, error, call } = useAction();
  const [leaving, setLeaving] = useState(false);
  const open = () =>
    call(
      () => openParadeState(to),
      ({ path }) => {
        setLeaving(true);
        window.location.assign(path);
      },
    );
  return { busy: pending || leaving, error, open };
}

/** Home's and Admin's "Parade state": a Tile-shaped button onto v1's Overview. */
export function ParadeStateTile() {
  const { busy, error, open } = useOpenParadeState("/");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-muted disabled:opacity-100"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary [&_svg]:size-[18px]" aria-hidden>
          <NotebookText />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Parade state</span>
          <span className="text-xs leading-snug text-muted-foreground">{busy ? "Opening…" : "Check and send today's parade state"}</span>
        </span>
        <Chevron busy={busy} />
      </button>
      {error && (
        <div className="px-3 py-2.5">
          <ErrorBox error={error} />
        </div>
      )}
    </>
  );
}

/** Any row that opens a v1 screen (Needs you's issues line, a camp on Manpower). `children` is the row's text; the caller sets its width. */
export function ParadeStateLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  const { busy, error, open } = useOpenParadeState(to);
  return (
    <>
      <button type="button" disabled={busy} onClick={open} className={`${className ?? ""} text-left disabled:opacity-100`}>
        {children}
        <Chevron busy={busy} />
      </button>
      {error && (
        <div className="px-3 py-2.5">
          <ErrorBox error={error} />
        </div>
      )}
    </>
  );
}

function Chevron({ busy }: { busy: boolean }) {
  return busy ? (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
  ) : (
    <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
  );
}
