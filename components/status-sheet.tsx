"use client";

import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { setStatus } from "@/lib/actions/attendance";
import { ABSENCE_TYPES, DATED_ABSENCE_TYPES, type AbsenceType, type SnapshotPerson } from "@/lib/parade/types";
import { STATUS_HINT, STATUS_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { PersonIssue } from "./camp-roster";

type Status = AbsenceType | "PRESENT";

const toInput = (hhmm: string | null) => (hhmm && hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : "");
const fromInput = (v: string) => (v ? v.replace(":", "") : null);

export function StatusSheet({
  people,
  issues,
  reasons,
  today,
  sabreHistory = false,
  open,
  onOpenChange,
  onSaved,
}: {
  people: SnapshotPerson[];
  issues: PersonIssue[];
  reasons: string[];
  today: string;
  /** opened from the Mini App: link one man to his Person history there */
  sabreHistory?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const single = people.length === 1 ? people[0] : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-2xl gap-0 overflow-y-auto rounded-t-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" />
        <SheetHeader className="pb-2">
          <SheetTitle className="text-lg">
            {single ? (
              <>
                <span className="text-muted-foreground">{single.rank}</span> {single.name}
              </>
            ) : (
              `${people.length} people`
            )}
          </SheetTitle>
          <SheetDescription>
            {single ? "Update attendance" : people.map((p) => `${p.rank} ${p.name}`).join(", ")}
          </SheetDescription>
          {single && sabreHistory && (
            // a full load: the Mini App has its own layout
            <a href={`/tg/people/${single.id}`} className="-ml-0.5 inline-flex min-h-11 w-fit items-center gap-0.5 text-sm font-medium text-primary active:opacity-70">
              Records in Sabre
              <ChevronRight className="size-4" />
            </a>
          )}
        </SheetHeader>
        {people.length > 0 && (
          <StatusForm
            key={people.map((p) => p.id).join()}
            people={people}
            issues={issues}
            reasons={reasons}
            today={today}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatusForm({
  people,
  issues,
  reasons,
  today,
  onSaved,
}: {
  people: SnapshotPerson[];
  issues: PersonIssue[];
  reasons: string[];
  today: string;
  onSaved: () => void;
}) {
  const initial = people.length === 1 ? people[0].absence : null;
  const [status, setStatusValue] = useState<Status>(
    people.length === 1 ? (initial?.type ?? "PRESENT") : "OTHERS",
  );
  const [otherReason, setOtherReason] = useState(initial?.otherReason ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [startTime, setStartTime] = useState(toInput(initial?.startTime ?? null));
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [endTime, setEndTime] = useState(toInput(initial?.endTime ?? null));
  const [maTiming, setMaTiming] = useState(toInput(initial?.maTiming ?? null));
  const [maLocation, setMaLocation] = useState(initial?.maLocation ?? "");
  const [pending, startTransition] = useTransition();

  const dated = status !== "PRESENT" && DATED_ABSENCE_TYPES.includes(status);

  function choose(next: Status) {
    setStatusValue(next);
    if (next !== "PRESENT" && (DATED_ABSENCE_TYPES.includes(next) || next === "MA") && !startDate) setStartDate(today);
  }

  function save() {
    startTransition(async () => {
      const res = await setStatus({
        personIds: people.map((p) => p.id),
        status,
        otherReason,
        startDate: startDate || null,
        startTime: fromInput(startTime),
        endDate: endDate || null,
        endTime: fromInput(endTime),
        maTiming: fromInput(maTiming) ?? "",
        maLocation,
      });
      if (res.ok) {
        toast.success(status === "PRESENT" ? "Marked present" : `Saved as ${STATUS_LABEL[status]}`);
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  }

  const reasonMatches = reasons
    .filter((r) => r.toLowerCase().includes(otherReason.trim().toLowerCase()) && r !== otherReason)
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {issues.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl bg-issue/10 p-3 text-sm text-issue">
          {issues.map((i) => (
            <p key={i.code} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {i.message.replace(/^'[^']*': /, "")}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {(["PRESENT", ...ABSENCE_TYPES] as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => choose(s)}
            className={cn(
              "flex h-14 flex-col items-center justify-center rounded-xl border text-sm font-semibold transition-colors",
              status === s
                ? s === "PRESENT"
                  ? "border-present bg-present text-background"
                  : "border-absent bg-absent text-black"
                : "bg-background hover:bg-muted",
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {status !== "PRESENT" && <p className="-mt-3 text-xs text-muted-foreground">{STATUS_HINT[status]}</p>}

      {status === "OTHERS" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="reason">Reason</Label>
          <Input
            id="reason"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
            placeholder="e.g. CBT COURSE, RSO, MP60 REHEARSALS @ MOWBRAY"
            className="h-11"
            autoComplete="off"
          />
          {reasonMatches.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reasonMatches.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setOtherReason(r)}
                  className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Printed exactly as typed. Dates are optional.</p>
        </div>
      )}

      {status === "MA" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
          </Field>
          <Field label="Timing">
            <Input type="time" value={maTiming} onChange={(e) => setMaTiming(e.target.value)} className="h-11" />
          </Field>
          <div className="col-span-2">
            <Field label="Location (optional)">
              <Input
                value={maLocation}
                onChange={(e) => setMaLocation(e.target.value)}
                placeholder="e.g. CMPB"
                className="h-11"
              />
            </Field>
          </div>
        </div>
      )}

      {(dated || status === "OTHERS") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={dated ? "Start date" : "Start date (optional)"}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
          </Field>
          <Field label="Start time (optional)">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-11" />
          </Field>
          <Field label={dated ? "End date" : "End date (optional)"}>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-11"
            />
          </Field>
          <Field label="End time (optional)">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-11" />
          </Field>
          <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
            Times only print when both start and end times are filled in.
          </p>
        </div>
      )}

      <Button size="lg" className="h-12 text-base" onClick={save} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
