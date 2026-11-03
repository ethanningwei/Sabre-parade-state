import { ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BigLink, Header } from "@/components/tg/form-bits";
import { EmptyState, Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { ddmmyy } from "@/lib/parade/time";
import { requireScreenPage } from "@/lib/wb/auth";
import { conductsList } from "@/lib/wb/conduct-data";
import { dueLabel } from "@/lib/wb/domain/named-list";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { currentPhase } from "@/lib/wb/phase";

// Conducts (slices 2 and 3 of docs/conducts-plan.md): today's and upcoming
// first, then the last week's, each with how many camps have sent. PS and above, an
// ASA or ADMIN. Vigilance only.
export default async function ConductsPage() {
  await requireFeaturePage();
  await requireFeaturePage("CONDUCTS");
  await requireScreenPage("conducts");
  if ((await currentPhase()).phase === "ROT") redirect("/tg");
  const today = todaySgt();
  const list = await conductsList(today);
  const ahead = list.filter((c) => c.date >= today);
  const past = list.filter((c) => c.date < today);
  const row = (c: (typeof list)[number]) => (
    <Link key={c.id} href={`/tg/conducts/${c.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{c.title}</span>
        <span className="text-xs text-muted-foreground">
          {c.kind === "NAMED" ? `Named · ${c.date === today ? "Today" : ddmmyy(c.date)} · due ${dueLabel(c)}` : `${c.date === today ? "Today" : ddmmyy(c.date)} · due ${c.reportBy}H`}
        </span>
      </span>
      <span className={`shrink-0 text-sm tabular-nums ${c.state === "CANCELLED" ? "text-muted-foreground line-through" : c.sent === c.camps ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {c.state === "CANCELLED" ? "Cancelled" : `${c.sent}/${c.camps} ${c.kind === "NAMED" ? "named" : "sent"}`}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
  return (
    <div className="flex flex-col gap-5">
      <Header title="Conducts" hint="Set one up and each camp's GC sends its strength, or names who's going, into Commanders of N23." />
      <BigLink href="/tg/conducts/new">Set up a conduct</BigLink>
      {!list.length && (
        <EmptyState icon={<ClipboardList />} title="No conducts this week">
          Set one up for the next CPT or OSE.
        </EmptyState>
      )}
      {ahead.length > 0 && (
        <Group title="Today and coming up" rows>
          {ahead.map(row)}
        </Group>
      )}
      {past.length > 0 && (
        <Group title="Last 7 days" rows>
          {past.map(row)}
        </Group>
      )}
    </div>
  );
}
