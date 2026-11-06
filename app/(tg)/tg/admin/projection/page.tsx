import { ProjectionSwitch, TakeOff } from "@/components/tg/admin/projection-switch";
import { ShiftOverride } from "@/components/tg/admin/shift-override";
import { Header } from "@/components/tg/form-bits";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { weekdayCamps } from "@/lib/wb/forecast-data";
import { diffNow, handTyped, projectedCounts, projectionLive } from "@/lib/wb/projection";

// Admin › Projection: is the parade state fed from the timeline (the switch,
// under FEATURE_PROJECTION on Vercel), what would change right now, the
// entries typed in the web app, and the weekday camps' override (admins only:
// a GC's own toggle in the web app is switched back).
export default async function ProjectionPage() {
  await requireFeaturePage();
  await requireScreenPage("admin");
  const available = isEnabled("PROJECTION");
  const live = await projectionLive();
  const [diff, counts, weekday, typed] = await Promise.all([diffNow(), projectedCounts(), weekdayCamps(), live ? handTyped() : Promise.resolve([])]);
  return (
    <div className="flex flex-col gap-4">
      <Header title="Projection" hint={live ? "On: Sabre owns the parade state" : "Off: shadow mode, nothing is written"} />
      <Group>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <p>
            {live
              ? "Approved leave, recorded MCs, RF deployments and HOTOs go onto the parade state. The web app can't change statuses, shifts or Extra/RF/SOL: everything goes through Sabre. A GC's entry from before gives way to an approved record."
              : available
                ? "Nothing reaches the parade state, and the GCs edit it in the web app as before. Switched on, Sabre owns it: the web app can't change statuses, shifts or Extra/RF/SOL."
                : "Nothing reaches the parade state. Every evening the admins get the shadow diff: what it would write. FEATURE_PROJECTION isn't set on Vercel, so it can't be switched on here."}
          </p>
          <p className="text-muted-foreground">
            On the parade state from here now: {counts.absences} absences, {counts.duties} Extra/RF/SOL.
          </p>
          <ProjectionSwitch on={live} available={available} />
        </div>
      </Group>
      {live && typed.length > 0 && (
        <Group title="Typed in the web app" rows hint="On the parade state with no record in Sabre behind it, so nothing here ever takes it off. Take it off once it's over, or put it in Sabre (an approved record replaces it).">
          {typed.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{t.who}</span>
                <span className="text-sm text-muted-foreground">{t.what}</span>
              </div>
              <TakeOff kind={t.kind} id={t.id} who={t.who} />
            </div>
          ))}
        </Group>
      )}
      {weekday.length > 0 && (
        <Group
          title="Weekday camps"
          rows
          hint={`Off at weekends and on public holidays, on again on the next working day. ${live ? "Only an override here changes one." : "Takes effect once projection is on."} To keep one on or off for a stretch, set it here.`}
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
