import { ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { EmptyState, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { canEditShifts, editsShiftsAnything } from "@/lib/wb/domain/rules";
import { minimumLabel } from "@/lib/wb/domain/shifts";
import { campsInfo, loadMinimums, loadPatterns, patternSummary, postsOf, shiftNote } from "@/lib/wb/forecast-data";

// Shifts admin: each physical camp's pattern and each team's minimum manning.
// ADMIN sees every camp; a PC/PS sees their platoon's.
export default async function ShiftsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!editsShiftsAnything(member.grants)) redirect("/tg");
  const [camps, patterns, minimums] = await Promise.all([campsInfo(), loadPatterns(), loadMinimums()]);
  const posts = postsOf(camps).filter((p) => canEditShifts(member.grants, p.subunitId));
  const now = new Date();
  // by id, not name: two coys can both have a PLATOON 5
  const platoons = [...new Map(posts.map((p) => [p.subunitId, p.subunitName]))];

  return (
    <div className="flex flex-col gap-6">
      <Header title="Shifts" hint="Who's on when, and what each guardroom can't go under. The forecast and the approval cards work from this." />
      {posts.length === 0 && <EmptyState icon={<Clock />} title="No camps in your platoon" />}
      {platoons.map(([subunitId, name]) => (
        <Group key={subunitId} title={name} rows className="tg-enter">
          {posts
            .filter((p) => p.subunitId === subunitId)
            .map((p) => {
              const lead = patterns.get(p.teams[0].id);
              return (
                <Link key={p.teams[0].id} href={`/tg/shifts/${p.teams[0].id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-150 active:bg-muted">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">{p.post}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{patternSummary(lead)}</span>
                    {p.teams.length > 1 && lead?.kind === "CYCLE" && (
                      <span className="text-xs leading-snug text-muted-foreground">
                        {p.teams.map((t) => `${t.name}: ${shiftNote(patterns.get(t.id), now).toLowerCase()}`).join(" · ")}
                      </span>
                    )}
                    {!p.isHq && (
                      <span className="text-xs leading-snug">
                        {p.teams.map((t) => `${p.teams.length > 1 ? `${t.name} ` : ""}min ${minimums.get(t.id) ? minimumLabel(minimums.get(t.id)!) : "not set"}`).join(" · ")}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                </Link>
              );
            })}
        </Group>
      ))}
    </div>
  );
}
