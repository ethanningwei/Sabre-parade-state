import { SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { StrengthList } from "@/components/tg/strength-list";
import { EmptyState } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { ddmmyy } from "@/lib/parade/time";
import { requireRegistered } from "@/lib/wb/auth";
import { conductCampView } from "@/lib/wb/conduct-data";
import { reportsFor } from "@/lib/wb/domain/access";
import { hhmmH } from "@/lib/wb/domain/conducts";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { zId } from "@/lib/wb/input";
import { currentPhase } from "@/lib/wb/phase";
import { strengthFor } from "@/lib/wb/strength-data";

// A camp's strength for a conduct (slice 2 of docs/conducts-plan.md): the
// GC's DM and Needs you open it. Slice 1's list, with the conduct's title and
// a Send that posts it into Commanders of N23. Its GC, or anyone above him.
export default async function ConductCampPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  await requireFeaturePage("CONDUCTS");
  const member = await requireRegistered();
  const { id } = await params;
  if ((await currentPhase()).phase === "ROT") redirect("/tg");
  const view = zId.safeParse(id).success ? await conductCampView(id) : null;
  if (!view) {
    return (
      <EmptyState icon={<SearchX />} title="That conduct is gone">
        It may have been set up again. Check your DMs from the bot.
      </EmptyState>
    );
  }
  const { conduct, camp } = view;
  if (!reportsFor(member, { subunitId: camp.subunitId, campId: camp.id })) redirect("/tg");
  const now = new Date();
  const found = await strengthFor(camp.id, now);
  const today = todaySgt(now);
  const blocked =
    conduct.state === "CANCELLED"
      ? "This conduct was cancelled. Nothing to send."
      : conduct.date !== today
        ? `This conduct is on ${ddmmyy(conduct.date)}. Strengths are sent on the day.`
        : null;
  return (
    <StrengthList
      campName={camp.name}
      date={conduct.date}
      men={found?.men ?? []}
      initialTaps={view.taps}
      send={{
        conductCampId: id,
        title: conduct.title,
        due: `Due ${conduct.reportBy}H`,
        sent: view.reportedAt ? `Sent ${hhmmH(view.reportedAt)}${view.reportedBy ? ` by ${view.reportedBy}` : ""}` : null,
        blocked,
      }}
    />
  );
}
