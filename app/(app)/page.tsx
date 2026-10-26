import { desc, eq, isNotNull } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, ChevronRight, Moon } from "lucide-react";
import Link from "next/link";
import { StrengthBar } from "@/components/strength-bar";
import { StrengthDial } from "@/components/strength-dial";
import { Card } from "@/components/ui/card";
import { requireViewer } from "@/lib/authz";
import { currentParade } from "@/lib/data/current";
import { db } from "@/lib/db";
import { paradeState, user } from "@/lib/db/schema";
import { ABSENCE_TYPES, computeCoy, currentCaa, ddmmyy, validate, type CampState } from "@/lib/parade";
import { formatSgt } from "@/lib/format";
import { addStrengths, strengthOf } from "@/lib/status";
import { cn } from "@/lib/utils";

/** "1 OL · 1 MC", or "All in": ROT's line per section (mockup 11). */
function absenceSummary(camps: CampState[]): string {
  const people = camps.flatMap((c) => c.absentees);
  const parts = ABSENCE_TYPES.map((t) => [t, people.filter((p) => p.absence!.type === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t === "OTHERS" ? "other" : t}`);
  return parts.length ? parts.join(" · ") : "All in";
}

export default async function OverviewPage() {
  const [viewer, { snapshot, phase, scOf }, [lastSent]] = await Promise.all([
    requireViewer(),
    currentParade(),
    db
      .select({ sentAt: paradeState.sentAt, caaDate: paradeState.caaDate, caaTime: paradeState.caaTime, by: user.name })
      .from(paradeState)
      .leftJoin(user, eq(user.id, paradeState.sentBy))
      .where(isNotNull(paradeState.sentAt))
      .orderBy(desc(paradeState.sentAt))
      .limit(1),
  ]);
  const caa = currentCaa();
  const state = computeCoy(snapshot);
  const issues = validate(snapshot, caa);
  const coyStrength = addStrengths(state.subunits.map((s) => strengthOf(s.camps, s.subunit.isHq)));

  const issuesBySubunit = new Map<string, number>();
  for (const i of issues) issuesBySubunit.set(i.scope[0], (issuesBySubunit.get(i.scope[0]) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-2xl bg-card px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Present strength</p>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums">
            CAA {ddmmyy(caa.date)} {caa.time}H{phase === "ROT" ? " · ROT" : ""}
          </span>
        </div>
        <StrengthDial strength={coyStrength} present={state.present} />
        <Link href="/parade" className="-mx-4 flex min-h-14 items-center gap-3 border-t px-4 py-3 text-sm transition-colors hover:bg-muted/50">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
              issues.length ? "bg-issue/12 text-issue" : "bg-present/12 text-present",
            )}
            aria-hidden
          >
            {issues.length ? <AlertTriangle /> : <CheckCircle2 />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              {issues.length ? (
                <>
                  <span className="text-issue">
                    {issues.length} issue{issues.length > 1 ? "s" : ""}
                  </span>{" "}
                  to fix before you can send
                </>
              ) : (
                "Ready to generate"
              )}
            </span>
            <span className="block text-xs text-muted-foreground">
              {lastSent?.sentAt
                ? `Last sent ${formatSgt(lastSent.sentAt)}${lastSent.by ? ` by ${lastSent.by}` : ""}`
                : "No parade state sent yet"}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">{phase === "ROT" ? "Platoons and sections" : "Subunits"}</h2>
        {state.subunits.map((s) => {
          // ROT (mockup 11): each platoon lists its sections, with their SC and who's away
          if (phase === "ROT") {
            const subIssues = issuesBySubunit.get(s.subunit.name) ?? 0;
            return (
              <Card key={s.subunit.id} className="gap-3 px-4">
                <Link href={`/s/${s.subunit.id}`} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{s.subunit.name}</span>
                      {s.subunit.isHq && <span className="text-xs text-muted-foreground">{absenceSummary(s.camps)}</span>}
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums">
                      {s.present}
                      <span className="text-sm text-muted-foreground">/{s.total}</span>
                    </span>
                  </div>
                  <StrengthBar strength={strengthOf(s.camps, s.subunit.isHq)} />
                </Link>
                {subIssues > 0 && (
                  <p className="text-xs font-medium text-issue">
                    {subIssues} issue{subIssues > 1 ? "s" : ""}
                  </p>
                )}
                {!s.subunit.isHq && (
                  <ul className="-mx-4 divide-y border-t">
                    {s.camps.map((c) => (
                      <li key={c.camp.id}>
                        <Link href={`/c/${c.camp.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/50">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-medium">
                              {c.camp.name}
                              {scOf.get(c.camp.id) && <span className="font-normal text-muted-foreground"> · SC {scOf.get(c.camp.id)}</span>}
                            </span>
                            <span className={`text-xs ${c.absentees.length ? "text-absent" : "text-muted-foreground"}`}>{absenceSummary([c])}</span>
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">
                            {c.present}
                            <span className="text-muted-foreground">/{c.total}</span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          }
          const offCamps = s.camps.filter((c) => !c.onShift).length;
          const dutyCount = s.subunit.isHq
            ? 0
            : s.camps.reduce((n, c) => n + c.duties.EXTRA.length + c.duties.RF.length + c.duties.SOL.length, 0);
          const subIssues = issuesBySubunit.get(s.subunit.name) ?? 0;
          const mine = viewer.role === "guardcomm" && viewer.subunitId === s.subunit.id;
          return (
            <Link key={s.subunit.id} href={`/s/${s.subunit.id}`}>
              <Card className="gap-3 px-4 transition-colors hover:bg-muted/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.subunit.name}</span>
                    {mine && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">Yours</span>}
                  </div>
                  <span className="font-mono text-lg font-semibold tabular-nums">
                    {s.present}
                    <span className="text-sm text-muted-foreground">/{s.total}</span>
                  </span>
                </div>
                <StrengthBar strength={strengthOf(s.camps, s.subunit.isHq)} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {/* off-shift camps aren't counted, so their absentees aren't either (as the bar) */}
                  <span>{absenceSummary(s.camps.filter((c) => c.onShift))}</span>
                  {offCamps > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Moon className="size-3" />
                      {offCamps} camp{offCamps > 1 ? "s" : ""} off shift
                    </span>
                  )}
                  {dutyCount > 0 && (
                    <span>
                      <span className="font-medium text-duty">+{dutyCount}</span> Extra/RF/SOL
                    </span>
                  )}
                  {subIssues > 0 && (
                    <span className="font-medium text-issue">
                      {subIssues} issue{subIssues > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
