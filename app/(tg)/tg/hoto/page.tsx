import { ArrowLeftRight } from "lucide-react";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { HotoPanel } from "@/components/tg/shifts/hoto-panel";
import { EmptyState, enter, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { onShiftAt } from "@/lib/wb/domain/shifts";
import { toSgt } from "@/lib/parade/time";
import { requireRegistered } from "@/lib/wb/auth";
import { canHoto, hotosAnything } from "@/lib/wb/domain/rules";
import { dayMonth } from "@/lib/wb/domain/timeline";
import { campsInfo, loadPatterns, postsOf, shiftNote } from "@/lib/wb/forecast-data";
import { recentHotos } from "@/lib/wb/shifts";

// HOTO: the GC (or PC/PS, OC/2IC/CSM) logs which team took over. It confirms
// the cycle or moves it. It does not change the parade state's shift toggle
// (that's Phase 6): the web app's toggle still decides the parade state.
export default async function HotoPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!hotosAnything(member.grants)) redirect("/tg");
  const [camps, patterns] = await Promise.all([campsInfo(), loadPatterns()]);
  const posts = postsOf(camps).filter(
    (p) => p.teams.some((t) => patterns.get(t.id)?.kind === "CYCLE") && canHoto(member.grants, p.subunitId, p.teams.map((t) => t.id)),
  );
  const now = new Date();
  const recent = await recentHotos(posts.flatMap((p) => p.teams.map((t) => t.id)), 20);
  const nameOf = new Map(camps.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6">
      <Header title="HOTO" hint="Log the handover when it happens. If it isn't when the cycle expected, the cycle moves and your commanders are told." />
      {posts.length === 0 && (
        <EmptyState icon={<ArrowLeftRight />} title="No camps that take turns">
          <p>A camp needs a cycle in Shifts before a HOTO can be logged.</p>
        </EmptyState>
      )}
      {posts.map((p, i) => (
        <Group key={p.post} title={`${p.post} · ${p.subunitName}`} className="tg-enter">
          <div className="flex flex-col gap-4 rounded-2xl bg-card p-4" style={enter(i)}>
            <ul className="flex flex-col gap-1 text-sm">
              {p.teams.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-muted-foreground">{shiftNote(patterns.get(t.id), now)}</span>
                </li>
              ))}
            </ul>
            <HotoPanel
              teams={p.teams.map((t) => { const pt = patterns.get(t.id); return { id: t.id, name: t.name, on: !!(pt && onShiftAt(pt, now)) }; })}
              today={toSgt(now).date}
              time={toSgt(now).time}
            />
            {recent.some((h) => p.teams.some((t) => t.id === h.campId)) && (
              <div className="flex flex-col gap-1 border-t pt-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Logged</p>
                {recent
                  .filter((h) => p.teams.some((t) => t.id === h.campId))
                  .slice(0, 3)
                  .map((h) => (
                    <p key={h.id} className="text-xs text-muted-foreground">
                      {dayMonth(toSgt(h.at).date)} {toSgt(h.at).time} · {nameOf.get(h.campId)} {h.on ? "took over" : "handed over"}
                      {h.matched ? "" : " · moved the cycle"}
                    </p>
                  ))}
              </div>
            )}
          </div>
        </Group>
      ))}
    </div>
  );
}
