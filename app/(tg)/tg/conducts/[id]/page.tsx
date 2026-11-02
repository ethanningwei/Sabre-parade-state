import { SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { ConductRollup } from "@/components/tg/conduct-rollup";
import { Header } from "@/components/tg/form-bits";
import { EmptyState, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { ddmmyy } from "@/lib/parade/time";
import { requireScreenPage } from "@/lib/wb/auth";
import { campGcs, conductView } from "@/lib/wb/conduct-data";
import { reportsFor } from "@/lib/wb/domain/access";
import { canNudge, coyTotalText, hhmmH, rollUp } from "@/lib/wb/domain/conducts";
import { groupLabel } from "@/lib/wb/domain/strength-list";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { zId } from "@/lib/wb/input";
import { currentPhase } from "@/lib/wb/phase";

// A conduct's roll-up (slice 2 of docs/conducts-plan.md): which camps have
// sent, the coy's totals by role, who isn't going and why; Nudge, Copy coy
// total (the app only: nothing extra goes into the chat), Cancel.
export default async function ConductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  await requireFeaturePage("CONDUCTS");
  const member = await requireScreenPage("conducts");
  if ((await currentPhase()).phase === "ROT") redirect("/tg");
  const { id } = await params;
  const view = zId.safeParse(id).success ? await conductView(id) : null;
  if (!view) {
    return (
      <EmptyState icon={<SearchX />} title="That conduct is gone">
        Go back to Conducts.
      </EmptyState>
    );
  }
  const { conduct, camps } = view;
  const waiting = camps.filter((c) => !c.reportedAt);
  const gcs = await campGcs(waiting.map((c) => c.campId));
  const r = rollUp(camps, groupLabel);
  const now = new Date();
  const today = todaySgt(now);
  const open = conduct.state === "OPEN" && conduct.date >= today;
  return (
    <div className="flex flex-col gap-5">
      <Header title={conduct.title} hint={`${conduct.date === today ? "Today" : ddmmyy(conduct.date)} · due ${conduct.reportBy}H`} />
      {conduct.state === "CANCELLED" && <p className="rounded-xl bg-muted px-3 py-2.5 text-sm">Cancelled.</p>}
      <section className="flex items-baseline justify-between rounded-2xl bg-card p-4">
        <p>
          <span className="text-3xl font-semibold tabular-nums">{r.going}</span>
          <span className="text-muted-foreground tabular-nums">/{r.total} going</span>
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {r.sent} of {r.camps} camps sent
        </p>
      </section>
      <ConductRollup
        conductId={conduct.id}
        open={open}
        coyTotal={coyTotalText(conduct, camps)}
        camps={camps.map((c) => ({
          id: c.id,
          campName: c.campName,
          sent: c.reportedAt ? `${hhmmH(c.reportedAt)}${c.reportedBy ? ` · ${c.reportedBy}` : ""}` : null,
          going: c.going,
          total: c.total,
          cooling: !canNudge(c.nudgedAt, now),
          noGc: !c.reportedAt && !gcs.some((g) => g.campId === c.campId),
          sendHref: conduct.state === "OPEN" && reportsFor(member, { subunitId: c.subunitId, campId: c.campId }) ? `/tg/conducts/camp/${c.id}` : null,
        }))}
      />
      {r.byRole.length > 0 && (
        <Group title="By role" rows>
          {r.byRole.map((x) => (
            <p key={x.label} className="flex min-h-11 items-center justify-between px-4 py-2 text-sm">
              <span className="font-medium">{x.label}</span>
              <span className="tabular-nums">
                {x.going}/{x.total}
              </span>
            </p>
          ))}
        </Group>
      )}
      {r.out.length > 0 && (
        <Group title={`Not going (${r.out.length})`} rows>
          {r.out.map((m, i) => (
            <p key={i} className="flex flex-col px-4 py-2.5 text-sm">
              <span className="font-medium">
                {m.rank} {m.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {m.campName} · {m.reason}
              </span>
            </p>
          ))}
        </Group>
      )}
    </div>
  );
}
