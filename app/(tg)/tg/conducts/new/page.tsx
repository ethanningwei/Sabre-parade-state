import { redirect } from "next/navigation";
import { ConductForm } from "@/components/tg/conduct-form";
import { Header } from "@/components/tg/form-bits";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { conductCoyId } from "@/lib/wb/conduct-data";
import { AHEAD_DAYS, preTicked } from "@/lib/wb/domain/conducts";
import { namedPreTicked, teamFor } from "@/lib/wb/domain/named-list";
import { addDays, todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo, loadPatterns } from "@/lib/wb/forecast-data";
import { currentPhase } from "@/lib/wb/phase";

// Set up a conduct (a strength or a named list): PS and above, an ASA or ADMIN. Vigilance only.
export default async function NewConductPage() {
  await requireFeaturePage();
  await requireFeaturePage("CONDUCTS");
  await requireScreenPage("conducts");
  if ((await currentPhase()).phase === "ROT") redirect("/tg");
  const today = todaySgt();
  const [camps, patterns, coyId] = await Promise.all([campsInfo(), loadPatterns(), conductCoyId()]);
  const guardrooms = camps.filter((c) => !c.isHq && c.coyId === coyId);
  const days = Array.from({ length: AHEAD_DAYS + 1 }, (_, i) => addDays(today, i));
  const ticked = Object.fromEntries(days.map((d) => [d, preTicked(guardrooms, patterns, d)]));
  const named = Object.fromEntries(
    days.map((d) => {
      const ids = namedPreTicked(guardrooms, patterns, d);
      return [d, { ticked: ids, team: teamFor(guardrooms, ids) }];
    }),
  );
  return (
    <div className="flex flex-col gap-5">
      <Header title="Set up a conduct" hint="Each camp's GC sends its strength, or names who's going, from Sabre. It goes into Commanders of N23." />
      <ConductForm days={days} camps={guardrooms.map((c) => ({ id: c.id, name: c.name, subunitName: c.subunitName }))} ticked={ticked} named={named} />
    </div>
  );
}
