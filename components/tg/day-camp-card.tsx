import { Hourglass } from "lucide-react";
import Link from "next/link";
import { ParadeStateLink } from "@/components/tg/parade-state-tile";
import { ParadeStatusLine } from "@/components/tg/parade-status";
import { enter } from "@/components/tg/ui";
import { sectionLabel } from "@/lib/wb/domain/rot";
import { minimumLabel } from "@/lib/wb/domain/shifts";
import type { DayCamp } from "@/lib/wb/forecast-data";
import type { ParadeStatus } from "@/lib/wb/projection";

// Manpower's day view, one card per camp: who's on shift, strength against the
// minimum, who's away and why (never a diagnosis), and who's been sent in.
// Statuses aren't here: they're on the man's own pages (2026-10-27).

/**
 * One camp on one day. `canOpen`: the viewer may open its records (a GC may not).
 * `onParadeState`: today, for a "Parade state" holder, the camp's v1 screen.
 * `rot`: a section in ROT: no shift, no minimum, just who's in.
 */
export function CampCard({
  d,
  i,
  parade,
  canOpen,
  onParadeState,
  rot = false,
}: {
  rot?: boolean;
  d: DayCamp;
  i: number;
  parade: ReadonlyMap<string, ParadeStatus>;
  canOpen: boolean;
  onParadeState: boolean;
}) {
  const on = d.manning.on;
  return (
    <article className="tg-enter flex flex-col gap-3 rounded-2xl bg-card p-4" style={enter(i)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="font-semibold">{rot ? sectionLabel(d.info.name, d.info.subunitName) : d.info.name}</h3>
          {!rot && <p className="text-xs text-muted-foreground">{d.shiftNote}</p>}
        </div>
        {rot ? (
          !d.info.isHq && (
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {d.manning.total - d.manning.away.length}
              <span className="font-normal text-muted-foreground">/{d.manning.total} in</span>
            </span>
          )
        ) : (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {on ? "On shift" : "Off shift"}
          </span>
        )}
      </div>
      {on && !d.info.isHq && !rot && (
        <p className={`text-sm tabular-nums ${d.short ? "font-semibold text-destructive" : ""}`}>
          {d.label}
          {d.minimum ? ` / min ${minimumLabel(d.minimum)}` : " · no minimum set"}
          {d.short ? " — below minimum" : ""}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {d.manning.total} posted
            {d.manning.duties.length ? `, +${d.manning.duties.length} Extra/RF/SOL` : ""}
          </span>
        </p>
      )}
      {d.away.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Away · {d.away.filter((a) => !a.pending).length}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {d.away.map((a) => {
              const line = (
                <>
                  <span className="font-medium">
                    {a.rank} {a.name}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {a.what}
                    {a.dates ? ` · ${a.dates}` : ""}
                  </span>
                  {a.pending && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400">
                      <Hourglass className="size-3" aria-hidden /> pending
                    </span>
                  )}
                  {a.recordId && parade.get(a.recordId) && (
                    <span className="block">
                      <ParadeStatusLine s={parade.get(a.recordId)!} compact />
                    </span>
                  )}
                </>
              );
              return (
                <li key={a.personId}>
                  {a.recordId && canOpen ? (
                    <Link href={`/tg/records/${a.recordId}`} className="-mx-2 -my-1 block min-h-11 rounded-lg px-2 py-2.5 transition-colors duration-150 active:bg-muted">
                      {line}
                    </Link>
                  ) : (
                    line
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {on && d.manning.duties.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sent in · Extra, RF, SOL · {d.manning.duties.length}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {d.manning.duties.map((x) => (
              <li key={x.id}>
                <span className="font-medium">
                  {x.rank} {x.name}
                </span>{" "}
                <span className="text-muted-foreground">· {x.type === "EXTRA" ? "Extra" : x.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.away.length === 0 && !(on && d.manning.duties.length) && <p className="text-sm text-muted-foreground">Everyone present.</p>}
      {onParadeState && (
        <ParadeStateLink
          to={`/c/${d.info.id}`}
          className="-mx-4 -mb-4 flex min-h-12 items-center gap-2 rounded-b-2xl border-t px-4 py-2.5 text-sm font-medium text-primary transition-colors duration-150 active:bg-muted"
        >
          <span className="flex-1">Open on the parade state</span>
        </ParadeStateLink>
      )}
    </article>
  );
}
