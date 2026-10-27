import { DeclareForm } from "@/components/tg/apply/declare-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";

// Statuses he already had when he joined Sabre (2026-10-27): the last step of
// registration (?from=register), Home's "Any statuses from before Sabre?", and
// My records' "Add a status you already have".
export default async function DeclareStatusesPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!(await rosterSelf(member))) return <NotOnRoster />;
  const { from } = await searchParams;
  return <DeclareForm today={todaySgt()} fromRegister={from === "register"} />;
}
