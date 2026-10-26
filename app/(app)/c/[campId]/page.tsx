import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampRoster } from "@/components/camp-roster";
import { canEditSubunit, requireViewer } from "@/lib/authz";
import { getReasonSuggestions } from "@/lib/data/reasons";
import { currentSnapshot } from "@/lib/data/current";
import { computeCoy, currentCaa, validate } from "@/lib/parade";
import { strengthOf } from "@/lib/status";
import { sabreLinksForCamp } from "@/lib/wb/v1-links";

export default async function CampPage({ params, searchParams }: PageProps<"/c/[campId]">) {
  const { campId } = await params;
  const { person } = await searchParams;
  const [viewer, snapshot, reasons] = await Promise.all([requireViewer(), currentSnapshot(), getReasonSuggestions()]);
  const caa = currentCaa();

  const sub = computeCoy(snapshot).subunits.find((s) => s.camps.some((c) => c.camp.id === campId));
  const campState = sub?.camps.find((c) => c.camp.id === campId);
  if (!sub || !campState) notFound();
  // opened from the Mini App: links back into it (null otherwise, and with the flag off)
  const sabre = await sabreLinksForCamp({ subunitId: sub.subunit.id, campId });

  const issues = validate(snapshot, caa)
    .filter((i) => i.target.kind === "person" && i.target.campId === campId)
    .map((i) => ({ personId: i.target.kind === "person" ? i.target.personId : "", code: i.code, message: i.message }));

  const duties = [...campState.duties.EXTRA, ...campState.duties.RF, ...campState.duties.SOL];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/s/${sub.subunit.id}`}
          className="-ml-1 inline-flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {sub.subunit.name}
        </Link>
        {sabre?.manpower && (
          <a href={sabre.manpower} className="-mr-1 inline-flex min-h-11 items-center gap-0.5 text-sm font-medium text-primary active:opacity-70">
            Manpower in Sabre
            <ChevronRight className="size-4" />
          </a>
        )}
      </div>
      <CampRoster
        camp={{ id: campState.camp.id, name: campState.camp.name, onShift: campState.onShift }}
        isHq={sub.subunit.isHq}
        present={campState.present}
        strength={strengthOf([campState], sub.subunit.isHq)}
        total={campState.total}
        people={campState.camp.people}
        issues={issues}
        duties={duties.map((d) => ({ id: d.id, type: d.type, rank: d.rank, name: d.name }))}
        canEdit={canEditSubunit(viewer, sub.subunit.id)}
        reasons={reasons}
        today={caa.date}
        openPersonId={typeof person === "string" ? person : null}
        sabreHistory={!!sabre?.history}
      />
    </div>
  );
}
