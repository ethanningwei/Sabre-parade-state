import { redirect } from "next/navigation";
import { StrengthList } from "@/components/tg/strength-list";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { campAccess } from "@/lib/wb/domain/access";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { currentPhase } from "@/lib/wb/phase";
import { strengthFor } from "@/lib/wb/strength-data";

type Search = { camp?: string | string[] };

// A camp's strength list for a conduct (slice 1 of docs/conducts-plan.md):
// its men now, filled in from Sabre; the GC taps only the differences and
// copies the text into Commanders of N23. Nothing is saved. Whoever sees the
// camp on Manpower may open it. Vigilance only: ROT has no CPT (the user,
// 2026-11-02).
export default async function StrengthPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireFeaturePage();
  const member = await requireScreenPage("manpower");
  const { camp } = await searchParams;
  if (typeof camp !== "string") redirect("/tg/manpower");
  if ((await currentPhase()).phase === "ROT") redirect("/tg/manpower");
  const now = new Date();
  const found = await strengthFor(camp, now);
  if (!found || found.info.isHq || !campAccess(member, { subunitId: found.info.subunitId, campId: found.info.id }).forecast) redirect("/tg/manpower");
  return <StrengthList campName={found.info.name} date={todaySgt(now)} men={found.men} />;
}
