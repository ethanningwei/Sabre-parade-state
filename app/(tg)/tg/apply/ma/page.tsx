import { MaForm } from "@/components/tg/apply/ma-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";
import { lastMa } from "@/lib/wb/records";

export default async function ApplyMaPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;
  return <MaForm today={todaySgt()} last={await lastMa(me.personId)} />;
}
