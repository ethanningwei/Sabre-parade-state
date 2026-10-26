import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShiftToggle } from "@/components/shift-toggle";
import { StrengthBar } from "@/components/strength-bar";
import { Card } from "@/components/ui/card";
import { canEditSubunit, requireViewer } from "@/lib/authz";
import { currentParade } from "@/lib/data/current";
import { computeCoy, currentCaa, validate } from "@/lib/parade";
import { strengthOf } from "@/lib/status";

export default async function SubunitPage({ params }: PageProps<"/s/[subunitId]">) {
  const { subunitId } = await params;
  const [viewer, { snapshot, phase }] = await Promise.all([requireViewer(), currentParade()]);
  const state = computeCoy(snapshot).subunits.find((s) => s.subunit.id === subunitId);
  if (!state) notFound();
  const canEdit = canEditSubunit(viewer, subunitId);

  const issuesByCamp = new Map<string, number>();
  for (const i of validate(snapshot, currentCaa())) {
    const campId = i.target.kind === "person" || i.target.kind === "camp" ? i.target.campId : null;
    if (campId) issuesByCamp.set(campId, (issuesByCamp.get(campId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{state.subunit.name}</h1>
          <p className="text-sm text-muted-foreground">{canEdit ? `Tap a ${phase === "ROT" ? "section" : "camp"} to update attendance` : "View only"}</p>
        </div>
        <p className="font-mono text-2xl font-semibold tabular-nums">
          {state.present}
          <span className="text-base text-muted-foreground">/{state.total}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {state.camps.map((c) => {
          const duties = c.duties.EXTRA.length + c.duties.RF.length + c.duties.SOL.length;
          const issues = issuesByCamp.get(c.camp.id) ?? 0;
          return (
            <Card key={c.camp.id} className="gap-3 px-4">
              <div className="flex items-center gap-3">
                <Link href={`/c/${c.camp.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-base font-medium">{c.camp.name}</span>
                  {issues > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-issue/10 px-2 py-0.5 text-[11px] font-medium text-issue">
                      <AlertTriangle className="size-3" />
                      {issues}
                    </span>
                  )}
                  <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
                </Link>
              </div>
              <Link href={`/c/${c.camp.id}`} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">
                    {c.onShift ? (
                      <>
                        <span className="font-medium text-absent">{c.absentees.length}</span> absent
                        {duties > 0 && (
                          <>
                            {" · "}
                            <span className="font-medium text-duty">+{duties}</span> Extra/RF/SOL
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-offshift">Off shift</span>
                    )}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {c.present}
                    <span className="text-muted-foreground">/{c.total}</span>
                  </span>
                </div>
                <StrengthBar strength={strengthOf([c], state.subunit.isHq)} />
              </Link>
              {/* ROT's sections are always on shift: no toggle (mockup 11) */}
              {!state.subunit.isHq && phase !== "ROT" && (
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-sm text-muted-foreground">On shift</span>
                  <ShiftToggle campId={c.camp.id} campName={c.camp.name} onShift={c.onShift} disabled={!canEdit} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
