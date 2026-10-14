import { Header } from "@/components/tg/form-bits";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { requireGrantPage } from "@/lib/wb/auth";
import { ADMIN_ROLES } from "@/lib/wb/permissions";
import { diffNow, projectedCounts } from "@/lib/wb/projection";

// Admin › Projection: is the parade state fed from the timeline, and what
// would change right now. Read-only: the switch is FEATURE_PROJECTION on Vercel.
export default async function ProjectionPage() {
  await requireFeaturePage();
  await requireGrantPage(ADMIN_ROLES);
  const live = isEnabled("PROJECTION");
  const [diff, counts] = await Promise.all([diffNow(), projectedCounts()]);
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
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Right now</h2>
        <pre className="overflow-x-auto rounded-xl bg-muted/50 p-4 font-sans text-sm whitespace-pre-wrap">{diff}</pre>
      </section>
    </div>
  );
}
