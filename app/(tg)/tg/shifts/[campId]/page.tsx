import { SearchX } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { ShiftForm, type ShiftFormInitial } from "@/components/tg/shifts/shift-form";
import { EmptyState } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { toSgt } from "@/lib/parade/time";
import { requireRegistered } from "@/lib/wb/auth";
import { postAccess } from "@/lib/wb/domain/access";
import { minimumLabel, stintAround, WEEKDAYS } from "@/lib/wb/domain/shifts";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo, loadMinimums, loadPatterns, postsOf } from "@/lib/wb/forecast-data";

// One physical camp's pattern (both teams of a pair at once) and each team's minimum.
export default async function ShiftEditPage({ params }: { params: Promise<{ campId: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { campId } = await params;
  const [camps, patterns, minimums] = await Promise.all([campsInfo(), loadPatterns(), loadMinimums()]);
  const post = postsOf(camps).find((p) => p.teams.some((t) => t.id === campId));
  if (!post || !postAccess(member, post).editShifts) {
    return (
      <EmptyState icon={<SearchX />} title="Not found">
        <p>That camp isn&apos;t in your platoon.</p>
      </EmptyState>
    );
  }

  const now = new Date();
  // the team on now (or next on), and the day its stint started: "SFT B took over 10/10 at 2100"
  const stints = post.teams
    .map((t) => ({ t, p: patterns.get(t.id) }))
    .filter((x) => x.p?.kind === "CYCLE" && x.p.anchorDate)
    .map((x) => ({ campId: x.t.id, stint: stintAround(x.p!, now)! }))
    .sort((a, b) => a.stint.startAt.getTime() - b.stint.startAt.getTime());
  const lead = patterns.get(post.teams[0].id);
  const initial: ShiftFormInitial = {
    kind: lead?.kind ?? (post.teams.length > 1 ? "CYCLE" : "WEEKLY"),
    onDays: lead?.onDays ?? 3,
    offDays: lead?.offDays ?? 3,
    anchorCampId: stints[0]?.campId ?? post.teams.at(-1)!.id,
    anchorDate: stints[0] ? toSgt(stints[0].stint.startAt).date : todaySgt(now),
    hotoTime: lead?.hotoTime ?? "2100",
    weekdayMask: lead?.kind === "WEEKLY" ? lead.weekdayMask : WEEKDAYS,
    holidaysOff: lead?.holidaysOff ?? true,
    bothOnAllowed: lead?.bothOnAllowed ?? false,
    minimums: Object.fromEntries(post.teams.map((t) => [t.id, minimums.get(t.id) ? minimumLabel(minimums.get(t.id)!) : ""])),
  };

  return (
    <div className="flex flex-col gap-5">
      <Header title={post.post} hint={`${post.subunitName}${post.teams.length > 1 ? ` · ${post.teams.map((t) => t.name).join(" and ")}` : ""}`} />
      <ShiftForm teams={post.teams.map((t) => ({ id: t.id, name: t.name }))} isHq={post.isHq} initial={initial} />
    </div>
  );
}
