import { CalendarX, ChevronLeft, ChevronRight, Hourglass } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { ParadeStatusLine } from "@/components/tg/parade-status";
import { EmptyState, enter, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { decidesAnything } from "@/lib/wb/domain/rules";
import { minimumLabel, WEEKDAY_NAMES, weekdayOf } from "@/lib/wb/domain/shifts";
import { addDays, dayMonthYear, todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo, dayView, forecastScope, type DayCamp } from "@/lib/wb/forecast-data";
import { paradeStatusesOf, type ParadeStatus } from "@/lib/wb/projection";

// One day for a commander's camps: who's on shift, strength against the
// minimum, who's away and why (from the timeline and Extra/RF/SOL; never a
// diagnosis), who's been sent in, and who's on a status. ?camp= narrows it to one camp.
export default async function DayPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ camp?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!decidesAnything(member.grants)) redirect("/tg");
  const { date: raw } = await params;
  const today = todaySgt();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : today;
  const camp = (await searchParams).camp;
  const only = typeof camp === "string" ? camp : null;

  const scoped = forecastScope(member.grants, await campsInfo()).filter((c) => !only || c.id === only);
  const days = scoped.length ? await dayView(scoped.map((c) => c.id), date) : [];
  // today, projection on: whether each standing record has reached the parade state
  const parade =
    date === today ? await paradeStatusesOf(days.flatMap((d) => d.away.flatMap((a) => (a.recordId && !a.pending ? [a.recordId] : [])))) : new Map<string, ParadeStatus>();
  const platoons = [...new Map(days.map((d) => [d.info.subunitId, d.info.subunitName]))];
  const q = only ? `?camp=${only}` : "";
  const nav = "tg-press flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary active:bg-muted";

  return (
    <div className="flex flex-col gap-5">
      <Header title={`${WEEKDAY_NAMES[weekdayOf(date)]} ${dayMonthYear(date)}${date === today ? " · Today" : ""}`} hint={only && days[0] ? days[0].info.name : "Your camps"} />
      <nav className="-mt-2 flex items-center justify-between" aria-label="Days">
        <Link href={`/tg/day/${addDays(date, -1)}${q}`} className={nav}>
          <ChevronLeft className="size-4" aria-hidden /> Day before
        </Link>
        {date !== today && (
          <Link href={`/tg/day/${today}${q}`} className={nav}>
            Today
          </Link>
        )}
        <Link href={`/tg/day/${addDays(date, 1)}${q}`} className={nav}>
          Day after <ChevronRight className="size-4" aria-hidden />
        </Link>
      </nav>
      {only && (
        <Link href={`/tg/day/${date}`} className="-mt-2 px-1 text-sm text-primary">
          Show all your camps
        </Link>
      )}
      {days.length === 0 && <EmptyState icon={<CalendarX />} title="Nothing to show" />}
      {platoons.map(([subunitId, name]) => (
        <Group key={subunitId} title={name}>
          {days
            .filter((d) => d.info.subunitId === subunitId)
            .map((d, i) => (
              <CampCard key={d.info.id} d={d} i={i} parade={parade} />
            ))}
        </Group>
      ))}
    </div>
  );
}

function CampCard({ d, i, parade }: { d: DayCamp; i: number; parade: ReadonlyMap<string, ParadeStatus> }) {
  const on = d.manning.on;
  return (
    <article className="tg-enter flex flex-col gap-3 rounded-2xl bg-card p-4" style={enter(i)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="font-semibold">{d.info.name}</h3>
          <p className="text-xs text-muted-foreground">{d.shiftNote}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {on ? "On shift" : "Off shift"}
        </span>
      </div>
      {on && !d.info.isHq && (
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
                  {a.recordId ? (
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
      {d.statuses.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">On status · present</p>
          <ul className="flex flex-col gap-1 text-sm">
            {d.statuses.map((s) => (
              <li key={`${s.personId}${s.what}`}>
                <span className="font-medium">
                  {s.rank} {s.name}
                </span>{" "}
                <span className="text-muted-foreground">· {s.what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.away.length === 0 && d.statuses.length === 0 && !(on && d.manning.duties.length) && <p className="text-sm text-muted-foreground">Everyone present.</p>}
    </article>
  );
}
