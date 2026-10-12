import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { EmptyState, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import type { GridRow } from "@/lib/wb/domain/forecast";
import { decidesAnything } from "@/lib/wb/domain/rules";
import { minimumLabel, WEEKDAY_NAMES, weekdayOf } from "@/lib/wb/domain/shifts";
import { campsInfo, FORECAST_DAYS, forecastScope, grid } from "@/lib/wb/forecast-data";

// The forecast: each guardroom × the next 14 days, strength against its
// minimum. Red: below minimum on what's approved. Striped: only short if the
// pending requests are approved. Grey: off shift. Tap a day for who's away.
export default async function ForecastPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!decidesAnything(member.grants)) redirect("/tg");
  const camps = forecastScope(member.grants, await campsInfo()).filter((c) => !c.isHq);
  const rows = camps.length ? await grid(camps.map((c) => c.id)) : [];
  const platoons = [...new Set(rows.map((r) => r.subunitName))];

  return (
    <div className="flex flex-col gap-5">
      <Header title="Forecast" hint={`The next ${FORECAST_DAYS} days. Strength reads GC:ST CBT:ST SVC.`} />
      <Legend />
      {rows.length === 0 && <EmptyState icon={<CalendarRange />} title="No guardrooms in your platoon" />}
      {platoons.map((name) => (
        <Group key={name} title={name} className="tg-enter">
          <Grid rows={rows.filter((r) => r.subunitName === name)} />
        </Group>
      ))}
    </div>
  );
}

function Legend() {
  const chip = "inline-block size-3 rounded-sm align-[-1px]";
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <span>
        <span className={`${chip} bg-destructive/25`} aria-hidden /> Below minimum
      </span>
      <span>
        <span className={`${chip} tg-stripes border border-amber-500/50`} aria-hidden /> Short if pending approved
      </span>
      <span>
        <span className={`${chip} bg-muted`} aria-hidden /> Off shift
      </span>
    </p>
  );
}

function Grid({ rows }: { rows: GridRow[] }) {
  const days = rows[0]?.cells.map((c) => c.date) ?? [];
  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-2xl bg-card">
      <table className="border-separate border-spacing-0 text-xs tabular-nums">
        <thead>
          <tr>
            <th className="tg-grid-sticky min-w-24 px-3 py-2 text-left font-medium text-muted-foreground">Camp</th>
            {days.map((d) => (
              <th key={d} scope="col" className="min-w-14 px-1 py-2 text-center font-medium text-muted-foreground">
                <span className="block">{WEEKDAY_NAMES[weekdayOf(d)]}</span>
                <span className="block text-foreground">{d.slice(8, 10)}/{d.slice(5, 7)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.campId}>
              <th scope="row" className="tg-grid-sticky border-t px-3 py-1.5 text-left font-medium">
                <span className="block">{r.campName}</span>
                <span className="block font-normal text-muted-foreground">min {r.minimum ? minimumLabel(r.minimum) : "—"}</span>
              </th>
              {r.cells.map((c) => {
                const tone = !c.on ? "bg-muted/60 text-muted-foreground" : c.short ? "bg-destructive/20 font-semibold text-destructive" : c.pendingShort ? "tg-stripes font-medium" : "";
                const title = !c.on
                  ? "Off shift"
                  : `${c.label}${r.minimum ? ` / min ${minimumLabel(r.minimum)}` : ""}${c.short ? ", below minimum" : ""}${c.pendingLabel ? `; with pending requests ${c.pendingLabel}` : ""}`;
                return (
                  <td key={c.date} className="border-t p-0.5">
                    <Link
                      href={`/tg/day/${c.date}?camp=${r.campId}`}
                      aria-label={`${r.campName} ${c.date}: ${title}`}
                      title={title}
                      className={`flex min-h-11 items-center justify-center rounded-md px-1 active:opacity-70 ${tone}`}
                    >
                      {c.on ? c.label : "off"}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
