import { House } from "lucide-react";
import { BackButton } from "@/components/tg/back-button";
import { Header } from "@/components/tg/form-bits";
import { EmptyState, enter } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { toSgt } from "@/lib/parade/time";
import { requireRegistered } from "@/lib/wb/auth";
import { backFor } from "@/lib/wb/projection";

const ended = (d: Date) => {
  const s = toSgt(d);
  return `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}${s.time === "0000" ? "" : ` ${s.time}H`}`;
};

// Back?: what Sabre put on the parade state that has ended, waiting for his
// GC, PC or PS to say he's back (2026-11-06). The evening "🏠 Back?" asks the
// same; this is for during the day, while the web app can't mark him back.
export default async function BackPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const due = await backFor(member);
  return (
    <div className="flex flex-col gap-4">
      <Header title="Back?" hint={due.length ? "Ended, and still on the parade state until someone says he's back." : undefined} />
      {due.length === 0 ? (
        <EmptyState icon={<House />} title="Nobody's waiting for Back." />
      ) : (
        due.map((d, i) => (
          <article key={d.projectionId} className="tg-enter flex flex-col gap-3 rounded-2xl bg-card p-4" style={enter(i)}>
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {d.rank} {d.name} <span className="font-normal text-muted-foreground">· {d.campName}</span>
              </p>
              <p className="text-sm">
                {d.what}, ended {ended(d.endAt)}
              </p>
            </div>
            <BackButton projectionId={d.projectionId} label={`${d.rank} ${d.name}`} />
          </article>
        ))
      )}
    </div>
  );
}
