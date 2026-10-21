import { ShiftOverride } from "@/components/tg/admin/shift-override";
import { Header } from "@/components/tg/form-bits";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { weekdayCamps } from "@/lib/wb/forecast-data";
import { diffNow, projectedCounts } from "@/lib/wb/projection";

// Admin › Projection: is the parade state fed from the timeline, what would
// change right now, and the weekday camps' override (admins only: a GC's own
// toggle in the web app is switched back). The switch itself is
// FEATURE_PROJECTION on Vercel.
export default async function ProjectionPage() {
  await requireFeaturePage();
  await requireScreenPage("admin");
  const live = isEnabled("PROJECTION");
  const [diff, counts, weekday] = await Promise.all([diffNow(), projectedCounts(), weekdayCamps()]);
  return (
    <div className="flex flex-col gap-4">
      <Header title="Projection" hint={live ? "On: the timeline writes to the parade state" : "Off: shadow mode, nothing is written"} />
      <Group>
        <div className="flex flex-col gap-1 p-4 text-sm">
          <p>
            {live
              ? "Approved leave, recorded MCs, RF deployments and HOTOs go onto the parade state as the GCs would type them. A GC's own entries are never overwritten."
              : "Nothing reaches the parade state. Every evening the admins get the shadow diff: what it would write. Turn FEATURE_PROJECTION on (Vercel, then redeploy) once it has been clean for a week."}
          </p>
          <p className="text-muted-foreground">
            On the parade state from here now: {counts.absences} absences, {counts.duties} Extra/RF/SOL.
          </p>
        </div>
      </Group>
      {weekday.length > 0 && (
        <Group
          title="Weekday camps"
          rows
          hint={`Off at weekends and on public holidays, on again on the next working day. ${live ? "A GC switching one in the web app is switched back at the next sync." : "Takes effect once projection is on."} To keep one on or off for a stretch, set it here.`}
        >
          {weekday.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.subunitName}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Parade state: {c.onShift ? "on" : "off"} · pattern: {c.patternOn ? "on" : "off"} today
                {c.override ? ` · ${c.override.label}` : ""}
              </p>
              <ShiftOverride campId={c.id} override={c.override} offers={c.offers} />
            </div>
          ))}
        </Group>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Right now</h2>
        <pre className="overflow-x-auto rounded-xl bg-muted/50 p-4 font-sans text-sm whitespace-pre-wrap">{diff}</pre>
      </section>
    </div>
  );
}
