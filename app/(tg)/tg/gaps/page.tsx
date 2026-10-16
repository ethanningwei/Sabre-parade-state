import { ChevronRight } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { WaitingRow, type CampOption } from "@/components/tg/roster/waiting-row";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { gapsFor } from "@/lib/wb/admin-data";
import { requireGrantPage } from "@/lib/wb/auth";
import { inGapsScope, similarName } from "@/lib/wb/domain/roster-flow";
import { GAPS_ROLES } from "@/lib/wb/permissions";
import { structure } from "@/lib/wb/roster";

// Who the system doesn't know about yet, for PS/PC/HQ to chase. Those who
// registered themselves are added to the roster (or linked) from here.
export default async function GapsPage() {
  await requireFeaturePage();
  const member = await requireGrantPage(GAPS_ROLES);
  const [g, subunits] = await Promise.all([gapsFor(member.grants), structure()]);
  const camps: CampOption[] = subunits.flatMap((sub) =>
    sub.camps.filter((c) => inGapsScope(member.grants, { subunitId: sub.id, campId: c.id })).map((c) => ({ id: c.id, name: c.name, subunitName: sub.name, isHq: sub.isHq })),
  );
  const bySubunit = new Map<string, typeof g.unregistered>();
  for (const p of g.unregistered) bySubunit.set(p.subunitName, [...(bySubunit.get(p.subunitName) ?? []), p]);

  return (
    <div className="flex flex-col gap-6">
      <Header title="Gaps" hint={g.scoped ? "Your platoon only." : "The whole company."} />

      <Section title="Not on the roster yet" count={g.selfOnly.length} hint="Registered themselves. Add them to the parade state here, or link them to who they already are on it.">
        {g.selfOnly.map((m) => (
          <WaitingRow
            key={m.id}
            memberId={m.id}
            label={m.label}
            sub={[m.where, m.tgUsername && `@${m.tgUsername}`].filter(Boolean).join(" · ")}
            self={m.self}
            campId={m.campId}
            camps={camps}
            candidates={g.unregistered
              .filter((p) => p.campId === m.campId && similarName(m.self.name ?? m.label, p.name))
              .map((p) => ({ personId: p.personId, label: `${p.rank} ${p.name}`, campName: p.campName }))}
          />
        ))}
      </Section>

      <Section title="Left the roster" count={g.left.length} hint="Their roster person is inactive. Deactivate them in Admin › Members, or re-link them.">
        {g.left.map((m) => (
          <Row key={m.id} title={m.label} sub={m.where} />
        ))}
      </Section>

      <Section title="Not registered" rows={false} count={g.unregistered.length} hint="On the parade state, but haven't opened Sabre yet.">
        {[...bySubunit].map(([sub, people]) => (
          // collapsed by platoon: open one at a time
          <details key={sub} className="group overflow-hidden rounded-2xl bg-card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium transition-colors duration-150 active:bg-muted [&::-webkit-details-marker]:hidden">
              {sub} · {people.length}
              <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
            </summary>
            <div className="tg-rows tg-reveal border-t">
              {people.map((p) => (
                <Row key={p.personId} title={`${p.rank} ${p.name}`} sub={p.campName} />
              ))}
            </div>
          </details>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, hint, rows = true, children }: { title: string; count: number; hint: string; rows?: boolean; children: React.ReactNode }) {
  return (
    <Group title={`${title} · ${count}`} hint={hint}>
      {count === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">None.</p>
      ) : rows ? (
        <div className="tg-rows overflow-hidden rounded-2xl bg-card">{children}</div>
      ) : (
        children
      )}
    </Group>
  );
}

function Row({ title, sub }: { title: string; sub?: string | null }) {
  return (
    <div className="px-4 py-2.5">
      <p className="text-sm font-medium">{title}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
