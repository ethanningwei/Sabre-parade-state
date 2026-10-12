import { requireFeaturePage } from "@/lib/flags";
import { gapsFor } from "@/lib/wb/admin-data";
import { requireGrantPage } from "@/lib/wb/auth";
import { GAPS_ROLES } from "@/lib/wb/permissions";

// Who the system doesn't know about yet, for PS/PC/HQ to chase.
export default async function GapsPage() {
  await requireFeaturePage();
  const member = await requireGrantPage(GAPS_ROLES);
  const g = await gapsFor(member.grants);
  const bySubunit = new Map<string, typeof g.unregistered>();
  for (const p of g.unregistered) bySubunit.set(p.subunitName, [...(bySubunit.get(p.subunitName) ?? []), p]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gaps</h1>
        <p className="text-sm text-muted-foreground">{g.scoped ? "Your platoon only." : "The whole company."}</p>
      </header>

      <Section title="Not on the roster yet" count={g.selfOnly.length} hint="Registered themselves. Add them in the parade-state app, then link them in Admin › Members.">
        {g.selfOnly.map((m) => (
          <Row key={m.id} title={m.label} sub={[m.where, m.tgUsername && `@${m.tgUsername}`].filter(Boolean).join(" · ")} />
        ))}
      </Section>

      <Section title="Left the roster" count={g.left.length} hint="Their roster person is inactive. Deactivate them in Admin › Members, or re-link them.">
        {g.left.map((m) => (
          <Row key={m.id} title={m.label} sub={m.where} />
        ))}
      </Section>

      <Section title="Not registered" count={g.unregistered.length} hint="On the parade state, but haven't opened Sabre yet.">
        {[...bySubunit].map(([sub, people]) => (
          // collapsed by platoon: open one at a time
          <details key={sub} className="group rounded-lg border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium">
              {sub} · {people.length}
              <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="flex flex-col gap-1 px-2 pb-2">
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

function Section({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-semibold">
          {title} <span className="text-muted-foreground">· {count}</span>
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {count === 0 ? <p className="text-sm text-muted-foreground">None.</p> : children}
    </section>
  );
}

function Row({ title, sub }: { title: string; sub?: string | null }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-sm font-medium">{title}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
