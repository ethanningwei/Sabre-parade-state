import { SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { NamedList } from "@/components/tg/named-list";
import { StrengthList } from "@/components/tg/strength-list";
import { EmptyState } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { ddmmyy } from "@/lib/parade/time";
import { requireRegistered } from "@/lib/wb/auth";
import { conductCampView } from "@/lib/wb/conduct-data";
import { reportsFor } from "@/lib/wb/domain/access";
import { hhmmH } from "@/lib/wb/domain/conducts";
import { dueLabel } from "@/lib/wb/domain/named-list";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { zId } from "@/lib/wb/input";
import { currentPhase } from "@/lib/wb/phase";
import { strengthFor, strengthOn } from "@/lib/wb/strength-data";

// A camp's part in a conduct (docs/conducts-plan.md): the GC's DM and Needs
// you open it. Its GC, or anyone above him.
//   - A strength (slice 2): slice 1's list, with the conduct's title and a
//     Send that posts it into Commanders of N23. On the day only.
//   - A named list (slice 3): tick who's going, warned of anyone away that
//     day; Send edits the coy list there. Until the day is over.
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
  const today = todaySgt(now);
  const sent = view.reportedAt ? `Sent ${hhmmH(view.reportedAt)}${view.reportedBy ? ` by ${view.reportedBy}` : ""}` : null;
  if (conduct.kind === "NAMED") {
    const found = await strengthOn(camp.id, conduct.date, now);
    return (
      <NamedList
        campName={camp.name}
        men={found?.men ?? []}
        initialPicked={view.picked}
        coyText={view.coyText}
        send={{
          conductCampId: id,
          title: `${ddmmyy(conduct.date)} ${conduct.title}${conduct.team ? ` (Team ${conduct.team})` : ""}`,
          due: `Due ${dueLabel(conduct)}`,
          sent,
          blocked:
            conduct.state === "CANCELLED"
              ? "This conduct was cancelled. Nothing to send."
              : conduct.date < today
                ? `This conduct was on ${ddmmyy(conduct.date)}. Names can't be changed now.`
                : null,
        }}
      />
    );
  }
  const found = await strengthFor(camp.id, now);
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
        sent,
        blocked,
      }}
    />
  );
}
