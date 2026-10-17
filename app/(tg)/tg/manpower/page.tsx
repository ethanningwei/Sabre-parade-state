import { CalendarX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CampCard } from "@/components/tg/day-camp-card";
import { DateStrip, type StripDay } from "@/components/tg/date-strip";
import { Grid, Legend } from "@/components/tg/forecast-grid";
import { Header } from "@/components/tg/form-bits";
import { EmptyState, Group, Segmented } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { hasGrant, requireRegistered } from "@/lib/wb/auth";
import { nextDays } from "@/lib/wb/domain/forecast";
import { canDecide, forecastsAnything } from "@/lib/wb/domain/rules";
import { WEEKDAY_NAMES, weekdayOf } from "@/lib/wb/domain/shifts";
import { dayMonthYear, todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo, dayView, FORECAST_DAYS, forecastScope, grid } from "@/lib/wb/forecast-data";
import { PARADE_STATE_ROLES } from "@/lib/wb/permissions";
import { paradeStatusesOf, type ParadeStatus } from "@/lib/wb/projection";

type Search = { date?: string | string[]; camp?: string | string[]; view?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

// Manpower: one screen for "who's here on a day" and "the next 14 days against
// minimum manning" (it replaces Today and Forecast, 2026-10-16). The day view
// has a row of the next 14 days, dotted where a camp is short; ?view=grid is
// the camps × days grid. ?camp= narrows either to one camp. PC/PS see their
// platoon, OC/2IC/CSM everyone, a GC his own camp (without opening records).
export default async function ManpowerPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!forecastsAnything(member.grants)) redirect("/tg");
  const sp = await searchParams;
  const today = todaySgt();
  const raw = one(sp.date);
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : today;
  const only = one(sp.camp);
  const gridView = one(sp.view) === "grid";

  const scoped = forecastScope(member.grants, await campsInfo()).filter((c) => !only || c.id === only);
  const guardrooms = scoped.filter((c) => !c.isHq);
  const [rows, days] = await Promise.all([
    guardrooms.length ? grid(guardrooms.map((c) => c.id)) : [],
    !gridView && scoped.length ? dayView(scoped.map((c) => c.id), date) : [],
  ]);
  // today, projection on: whether each standing record has reached the parade state
  const parade =
    !gridView && date === today
      ? await paradeStatusesOf(days.flatMap((d) => d.away.flatMap((a) => (a.recordId && !a.pending ? [a.recordId] : []))))
      : new Map<string, ParadeStatus>();

  const q = only ? `&camp=${only}` : "";
  const where = only && scoped[0] ? scoped[0].name : scoped.length === 1 ? scoped[0].name : "Your camps";
  const empty = scoped.length === 0 && <EmptyState icon={<CalendarX />} title="No camps to show" />;
  const allCamps = only && (
    <Link href={gridView ? "/tg/manpower?view=grid" : `/tg/manpower?date=${date}`} replace className="-mt-2 px-1 text-sm text-primary">
      Show all your camps
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <Header title="Manpower" hint={gridView ? `${where} · strength reads GC:ST CBT:ST SVC.` : where} />
      <Segmented
        label="View"
        items={[
          { href: `/tg/manpower?date=${date}${q}`, label: "Day", on: !gridView },
          { href: `/tg/manpower?view=grid${q}`, label: `${FORECAST_DAYS} days`, on: gridView },
        ]}
      />
      {allCamps}
      {empty}
      {gridView ? <GridView rows={rows} /> : scoped.length > 0 && <DayView rows={rows} days={days} date={date} today={today} q={q} parade={parade} grants={member.grants} />}
    </div>
  );
}

function GridView({ rows }: { rows: Awaited<ReturnType<typeof grid>> }) {
  if (!rows.length) return <EmptyState icon={<CalendarX />} title="No guardrooms to forecast" />;
  const platoons = [...new Map(rows.map((r) => [r.subunitId, r.subunitName]))];
  return (
    <>
      <Legend />
      {platoons.map(([subunitId, name]) => (
        <Group key={subunitId} title={name} className="tg-enter">
          <Grid rows={rows.filter((r) => r.subunitId === subunitId)} />
        </Group>
      ))}
    </>
  );
}

function DayView({
  rows,
  days,
  date,
  today,
  q,
  parade,
  grants,
}: {
  rows: Awaited<ReturnType<typeof grid>>;
  days: Awaited<ReturnType<typeof dayView>>;
  date: string;
  today: string;
  q: string;
  parade: ReadonlyMap<string, ParadeStatus>;
  grants: Parameters<typeof canDecide>[0];
}) {
  const strip: StripDay[] = nextDays(today, FORECAST_DAYS).map((d) => {
    const cells = rows.flatMap((r) => r.cells.filter((c) => c.date === d));
    return {
      date: d,
      label: d === today ? "Today" : WEEKDAY_NAMES[weekdayOf(d)],
      day: String(Number(d.slice(8, 10))),
      tone: cells.some((c) => c.on && c.short) ? "short" : cells.some((c) => c.on && c.pendingShort) ? "pending" : null,
      href: `/tg/manpower?date=${d}${q}`,
    };
  });
  const onShift = days.filter((d) => d.manning.on && !d.info.isHq);
  const short = onShift.filter((d) => d.short).length;
  const platoons = [...new Map(days.map((d) => [d.info.subunitId, d.info.subunitName]))];
  // the parade state is today's: each camp links to its v1 screen
  const paradeToday = date === today && hasGrant(grants, PARADE_STATE_ROLES, "any");

  return (
    <>
      <DateStrip days={strip} selected={date} />
      <p className="-mt-1 px-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {WEEKDAY_NAMES[weekdayOf(date)]} {dayMonthYear(date)}
          {date === today ? " · Today" : ""}
        </span>
        {` · ${onShift.length} on shift`}
        {short > 0 && <span className="font-medium text-destructive">{` · ${short} below minimum`}</span>}
      </p>
      {platoons.map(([subunitId, name]) => (
        <Group key={subunitId} title={name}>
          {days
            .filter((d) => d.info.subunitId === subunitId)
            .map((d, i) => (
              <CampCard
                key={d.info.id}
                d={d}
                i={i}
                parade={parade}
                canOpen={canDecide(grants, { subunitId: d.info.subunitId, campId: d.info.id })}
                onParadeState={paradeToday}
              />
            ))}
        </Group>
      ))}
    </>
  );
}
