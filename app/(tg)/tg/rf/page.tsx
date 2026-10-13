import { Bus, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { RfSummary } from "@/components/tg/rf/rf-summary";
import { EmptyState, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { rfAnything } from "@/lib/wb/domain/rf";
import { board } from "@/lib/wb/rf-data";

// The RF board: what the company is still short of, soonest first, then what
// was filled or closed in the last week. Everyone with an RF role sees all of
// it: any platoon may have the men to spare.
export default async function RfBoardPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!rfAnything(member.grants)) redirect("/tg");
  const now = new Date();
  const { open, settled } = await board(now);
  const action = "tg-press flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-card px-3 text-sm font-medium text-primary active:bg-muted";

  return (
    <div className="flex flex-col gap-6">
      <Header title="RF board" hint="Camps that will be short, and who's been sent." />
      <div className="-mt-2 flex gap-2">
        <Link href="/tg/rf/new" className={action}>
          <Plus className="size-4" aria-hidden /> Ask for manpower
        </Link>
        <Link href="/tg/assign" className={action}>
          <UserPlus className="size-4" aria-hidden /> Assign
        </Link>
      </div>
      {open.length === 0 ? (
        <EmptyState icon={<Bus />} title="Nothing outstanding">
          <p>No camp is asking for manpower.</p>
        </EmptyState>
      ) : (
        <Group title={`Still short · ${open.length}`}>
          {open.map((r, i) => (
            <RfSummary key={r.id} r={r} now={now} href={`/tg/rf/${r.id}`} i={i}>
              <Link href={`/tg/rf/${r.id}/deploy`} className="tg-press flex min-h-12 items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground">
                Deploy someone
              </Link>
            </RfSummary>
          ))}
        </Group>
      )}
      {settled.length > 0 && (
        <Group title="Filled or closed lately">
          {settled.map((r, i) => (
            <RfSummary key={r.id} r={r} now={now} href={`/tg/rf/${r.id}`} i={i} />
          ))}
        </Group>
      )}
    </div>
  );
}
