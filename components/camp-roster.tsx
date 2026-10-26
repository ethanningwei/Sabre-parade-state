"use client";

import { AlertTriangle, CheckCheck, ListChecks, Moon, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { ShiftToggle } from "@/components/shift-toggle";
import { StatusAvatar, StatusChip } from "@/components/status-chip";
import { StrengthBar } from "@/components/strength-bar";
import { StatusSheet } from "@/components/status-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { setStatus } from "@/lib/actions/attendance";
import type { DutyType, IssueCode, SnapshotPerson } from "@/lib/parade/types";
import { absenceSummary, type Strength } from "@/lib/status";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/count-up";

type Filter = "all" | "absent" | "present" | "issues";
const FILTER_DOT: Record<Exclude<Filter, "all">, string> = { absent: "bg-absent", present: "bg-present", issues: "bg-issue" };

export interface PersonIssue {
  personId: string;
  code: IssueCode;
  message: string;
}

export function CampRoster({
  camp,
  isHq,
  present,
  strength,
  total,
  people,
  issues,
  duties,
  canEdit,
  reasons,
  today,
  openPersonId,
  sabreHistory = false,
}: {
  camp: { id: string; name: string; onShift: boolean };
  isHq: boolean;
  present: number;
  strength: Strength;
  total: number;
  people: SnapshotPerson[];
  issues: PersonIssue[];
  duties: { id: string; type: DutyType; rank: string; name: string }[];
  canEdit: boolean;
  reasons: string[];
  today: string;
  openPersonId: string | null;
  /** opened from the Mini App by someone who may see these men's records there */
  sabreHistory?: boolean;
}) {
  // an off-shift team isn't printed or counted, so it's locked
  const editable = canEdit && camp.onShift;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(issues.length ? "issues" : "all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<string[] | null>(
    editable && openPersonId && people.some((p) => p.id === openPersonId) ? [openPersonId] : null,
  );
  const [pending, startTransition] = useTransition();

  const issuesByPerson = useMemo(() => {
    const m = new Map<string, PersonIssue[]>();
    for (const i of issues) m.set(i.personId, [...(m.get(i.personId) ?? []), i]);
    return m;
  }, [issues]);

  const absentCount = people.filter((p) => p.absence).length;
  const issueCount = issuesByPerson.size;

  // issues first, then absentees, then present — roster order within each
  const rank = (p: SnapshotPerson) => (issuesByPerson.has(p.id) ? 0 : p.absence ? 1 : 2);
  const visible = people
    .filter((p) => {
      if (query && !`${p.rank} ${p.name}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === "absent") return !!p.absence;
      if (filter === "present") return !p.absence;
      if (filter === "issues") return issuesByPerson.has(p.id);
      return true;
    })
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function markPresent(ids: string[]) {
    startTransition(async () => {
      const res = await setStatus({ personIds: ids, status: "PRESENT" });
      if (res.ok) toast.success(ids.length > 1 ? `${ids.length} marked present` : "Marked present");
      else toast.error(res.error);
    });
  }

  const sheetPeople = sheetFor ? people.filter((p) => sheetFor.includes(p.id)) : [];

  return (
    <>
      <div className="flex items-end justify-between px-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{camp.name}</h1>
          <p className="text-sm text-muted-foreground">
            {absentCount} absent · {total} total{!canEdit && " · view only"}
          </p>
        </div>
        <p className="font-mono text-2xl font-semibold tabular-nums">
          <CountUp value={present} />
          <span className="text-base text-muted-foreground">/{total}</span>
        </p>
      </div>
      <StrengthBar strength={strength} className="mx-1 -mt-2 h-1.5" />

      {!camp.onShift && (
        <div className="flex items-start gap-3 rounded-2xl bg-offshift/10 p-3 text-sm">
          <Moon className="mt-0.5 size-4 shrink-0 text-offshift" />
          <p className="flex-1">
            <span className="font-medium">Off shift.</span> Counts as 00 present, and nobody here is checked or listed,
            so attendance is locked. Put the camp on shift to update it.
          </p>
          {canEdit && !isHq && <ShiftToggle campId={camp.id} campName={camp.name} onShift={camp.onShift} />}
        </div>
      )}

      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-2 bg-page/90 px-4 py-2 backdrop-blur-md">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or rank"
              className="h-10 bg-card pl-9 dark:bg-card"
              inputMode="search"
            />
          </div>
          {editable && (
            <Button
              variant={selecting ? "secondary" : "outline"}
              className="h-10 shrink-0"
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
            >
              {selecting ? <X /> : <ListChecks />}
              {selecting ? "Cancel" : "Select"}
            </Button>
          )}
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {(
            [
              ["all", `All ${people.length}`],
              ["absent", `Absent ${absentCount}`],
              ["present", `Present ${people.length - absentCount}`],
              ["issues", `Issues ${issueCount}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                filter === key ? "border-primary bg-primary text-primary-foreground" : "border-transparent bg-card text-foreground",
                key === "issues" && issueCount > 0 && filter !== key && "bg-issue/10 text-issue",
              )}
            >
              {key !== "all" && <span aria-hidden className={cn("size-2 rounded-full", FILTER_DOT[key], filter === key && "ring-2 ring-primary-foreground/70")} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="-mt-2 flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
        {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nobody here.</li>}
        {visible.map((p) => {
          const personIssues = issuesByPerson.get(p.id) ?? [];
          const overdue = personIssues.some((i) => i.code === "overdue-absence");
          return (
            <li key={p.id} className={cn("flex items-center gap-3 px-3 py-3", !camp.onShift && "opacity-60")}>
              {selecting && (
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  aria-label={`Select ${p.name}`}
                  className="size-5"
                />
              )}
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => (selecting ? toggle(p.id) : editable ? setSheetFor([p.id]) : undefined)}
                disabled={!editable && !selecting}
              >
                <StatusAvatar name={p.name} status={camp.onShift ? (p.absence?.type ?? "PRESENT") : "OFFSHIFT"} overdue={overdue} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">
                    <span className="text-muted-foreground">{p.rank || "—"}</span> {p.name}
                  </p>
                  {p.absence && <p className="truncate text-xs text-muted-foreground">{absenceSummary(p.absence)}</p>}
                  {personIssues
                    .filter((i) => i.code !== "overdue-absence")
                    .map((i) => (
                      <p key={i.code} className="flex items-center gap-1 text-xs text-issue">
                        <AlertTriangle className="size-3" />
                        {i.message.replace(/^'[^']*': /, "")}
                      </p>
                    ))}
                </div>
                <StatusChip status={camp.onShift ? (p.absence?.type ?? "PRESENT") : "OFFSHIFT"} overdue={overdue} />
              </button>
              {overdue && editable && !selecting && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => markPresent([p.id])}>
                  Back
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {duties.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Serving here (Extra/RF/SOL)</h2>
            <Link href="/duties" className="text-xs text-primary">
              Manage
            </Link>
          </div>
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
            {duties.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span>
                  <span className="text-muted-foreground">{d.rank}</span> {d.name}
                </span>
                <span className="rounded-full bg-duty/12 px-2 py-0.5 text-xs font-semibold text-duty">{d.type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selecting && (
        // lets the last rows scroll above the floating bar
        <div aria-hidden className="h-20" />
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-4 pb-3">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border bg-popover p-2 shadow-lg">
            <span className="px-2 text-sm font-medium">{selected.size} selected</span>
            <Button
              variant="outline"
              className="ml-auto"
              disabled={!selected.size || pending}
              onClick={() => {
                markPresent([...selected]);
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              <CheckCheck /> Present
            </Button>
            <Button disabled={!selected.size} onClick={() => setSheetFor([...selected])}>
              Set status
            </Button>
          </div>
        </div>
      )}

      <StatusSheet
        people={sheetPeople}
        issues={sheetFor?.length === 1 ? (issuesByPerson.get(sheetFor[0]) ?? []) : []}
        reasons={reasons}
        today={today}
        sabreHistory={sabreHistory}
        open={sheetFor !== null}
        onOpenChange={(open) => {
          if (!open) setSheetFor(null);
        }}
        onSaved={() => {
          setSheetFor(null);
          setSelecting(false);
          setSelected(new Set());
        }}
      />
    </>
  );
}
