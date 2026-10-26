"use client";

import { AlertTriangle, Info, Loader2, Plus, Search, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { endDuty, saveDuty } from "@/lib/actions/duties";
import { ddmmyy } from "@/lib/parade/time";
import { DUTY_TYPES, type DutyType, type SnapshotDuty } from "@/lib/parade/types";
import { cn } from "@/lib/utils";

interface CampOption {
  id: string;
  name: string;
  post: string;
  onShift: boolean;
  subunit: string;
  canEdit: boolean;
}
interface RosterOption {
  id: string;
  rank: string;
  name: string;
  campId: string;
}
type Duty = SnapshotDuty & { servingCampId: string | null };

const DUTY_LABEL: Record<DutyType, string> = { EXTRA: "Extra", RF: "RF", SOL: "SOL" };
const DUTY_HINT: Record<DutyType, string> = {
  EXTRA: "Serving extra at another camp. They're marked absent at their own team.",
  RF: "Reinforcing another camp. They're marked absent at their own team.",
  SOL: "Stoppage of leave: stays in camp while their own team is off shift.",
};

const toInput = (hhmm: string | null) => (hhmm ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : "");
const fromInput = (v: string) => (v ? v.replace(":", "") : null);

/** Where an SOL counts, in words. */
function solStatus(home: CampOption | undefined, camps: CampOption[]): { counted: string | null; note: string } {
  if (!home) return { counted: null, note: "" };
  const siblings = camps.filter((c) => c.post === home.post && c.id !== home.id);
  if (home.onShift) return { counted: null, note: `${home.name} is on shift, so they count as present there, not as SOL.` };
  const on = siblings.find((c) => c.onShift);
  if (on) return { counted: on.name, note: `${home.name} is off shift, so they count as SOL under ${on.name}.` };
  if (!siblings.length) return { counted: null, note: `${home.name} has no other team, so this SOL is never counted.` };
  return { counted: null, note: `No team at ${home.post} is on shift, so this SOL isn't counted right now.` };
}

export function DutiesView({
  duties,
  camps,
  roster,
  issues,
  today,
  openDutyId,
}: {
  duties: Duty[];
  camps: CampOption[];
  roster: RosterOption[];
  issues: { dutyId: string; message: string }[];
  today: string;
  openDutyId: string | null;
}) {
  const [editing, setEditing] = useState<Duty | "new" | null>(duties.find((d) => d.id === openDutyId) ?? null);
  const campById = new Map(camps.map((c) => [c.id, c]));
  const canAdd = camps.some((c) => c.canEdit);
  const issuesByDuty = new Map<string, string[]>();
  for (const i of issues) issuesByDuty.set(i.dutyId, [...(issuesByDuty.get(i.dutyId) ?? []), i.message]);

  const counted = camps
    .map((c) => ({ camp: c, list: duties.filter((d) => d.servingCampId === c.id) }))
    .filter((g) => g.list.length);
  const notCounted = duties.filter((d) => !d.servingCampId);

  function whyNot(d: Duty): string {
    const c = campById.get(d.campId);
    if (d.type === "SOL" && d.personId) return solStatus(c, camps).note;
    return c ? `${c.name} is off shift.` : "";
  }

  function row(d: Duty, sub: string) {
    const problems = issuesByDuty.get(d.id) ?? [];
    const editable = campById.get(d.campId)?.canEdit ?? false;
    return (
      <li key={d.id}>
        <button
          className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-default"
          onClick={() => setEditing(d)}
          disabled={!editable}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">
              <span className="text-muted-foreground">{d.rank}</span> {d.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {d.startDate ? ddmmyy(d.startDate) : "?"} – {d.endDate ? ddmmyy(d.endDate) : "?"}
              {sub && ` · ${sub}`}
            </p>
            {problems.map((m) => (
              <p key={m} className="flex items-center gap-1 text-xs text-issue">
                <AlertTriangle className="size-3 shrink-0" /> {m.replace(/^'[^']*' \([A-Z]+\): /, "")}
              </p>
            ))}
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              problems.length ? "bg-issue/12 text-issue" : "bg-duty/12 text-duty",
            )}
          >
            {DUTY_LABEL[d.type]}
          </span>
        </button>
      </li>
    );
  }

  const homeName = (d: Duty) => {
    const r = d.personId ? roster.find((p) => p.id === d.personId) : null;
    return r ? `from ${campById.get(r.campId)?.name}` : "";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Extra / RF / SOL</h1>
          <p className="text-sm text-muted-foreground">Added to the present strength of the camp they serve at</p>
        </div>
        {canAdd && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add
          </Button>
        )}
      </div>

      {duties.length === 0 && (
        <div className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground">
          Nobody is serving Extra, RF or SOL right now.
        </div>
      )}

      {counted.map(({ camp, list }) => (
        <section key={camp.id} className="flex flex-col gap-2">
          <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">
            {camp.subunit} › {camp.name}
          </h2>
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">{list.map((d) => row(d, homeName(d)))}</ul>
        </section>
      ))}

      {notCounted.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Not counted right now</h2>
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border border-dashed bg-card/50">
            {notCounted.map((d) => row(d, whyNot(d)))}
          </ul>
        </section>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-2xl gap-0 overflow-y-auto rounded-t-2xl">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" />
          <SheetHeader className="pb-2">
            <SheetTitle className="text-lg">{editing === "new" ? "Add Extra / RF / SOL" : "Edit"}</SheetTitle>
            <SheetDescription>{editing && editing !== "new" ? `${editing.rank} ${editing.name}` : "Who is serving, and where"}</SheetDescription>
          </SheetHeader>
          {editing !== null && (
            <DutyForm
              key={editing === "new" ? "new" : editing.id}
              duty={editing === "new" ? null : editing}
              camps={camps}
              roster={roster}
              today={today}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DutyForm({
  duty,
  camps,
  roster,
  today,
  onDone,
}: {
  duty: Duty | null;
  camps: CampOption[];
  roster: RosterOption[];
  today: string;
  onDone: () => void;
}) {
  const campById = new Map(camps.map((c) => [c.id, c]));
  const [type, setType] = useState<DutyType>(duty?.type ?? "RF");
  const [personId, setPersonId] = useState<string | null>(duty?.personId ?? null);
  const [outsider, setOutsider] = useState(Boolean(duty && !duty.personId));
  const [rank, setRank] = useState(duty?.rank ?? "");
  const [name, setName] = useState(duty?.name ?? "");
  const [campId, setCampId] = useState(duty && duty.type !== "SOL" ? duty.campId : "");
  const [startDate, setStartDate] = useState(duty?.startDate ?? today);
  const [startTime, setStartTime] = useState(toInput(duty?.startTime ?? null));
  const [endDate, setEndDate] = useState(duty?.endDate ?? today);
  const [endTime, setEndTime] = useState(toInput(duty?.endTime ?? null));
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();

  const person = personId ? roster.find((p) => p.id === personId) : undefined;
  const home = person ? campById.get(person.campId) : undefined;
  const isSol = type === "SOL";
  const needsPerson = isSol || !outsider;
  // Extra/RF go to another team — never their own
  const campChoices = camps.filter((c) => c.canEdit && c.id !== home?.id);
  const sol = isSol ? solStatus(home, camps) : null;

  const matches =
    search.trim().length >= 2
      ? roster.filter((p) => `${p.rank} ${p.name}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6)
      : [];

  function save() {
    startTransition(async () => {
      const res = await saveDuty({
        id: duty?.id,
        type,
        rank: needsPerson ? "" : rank,
        name: needsPerson ? "" : name,
        personId: needsPerson ? personId : null,
        campId: isSol ? null : campId || null,
        startDate: startDate || null,
        startTime: fromInput(startTime),
        endDate: endDate || null,
        endTime: fromInput(endTime),
      });
      if (res.ok) {
        toast.success("Saved");
        onDone();
      } else toast.error(res.error);
    });
  }

  function end() {
    if (!duty) return;
    startTransition(async () => {
      const res = await endDuty(duty.id);
      if (res.ok) {
        toast.success(`${duty.rank} ${duty.name} removed`);
        onDone();
      } else toast.error(res.error);
    });
  }

  const ready =
    Boolean(startDate && endDate) && (needsPerson ? Boolean(personId) : Boolean(rank.trim() && name.trim())) && (isSol || Boolean(campId));

  return (
    <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          {DUTY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "h-12 rounded-xl border text-sm font-semibold transition-colors",
                type === t ? "border-duty bg-duty text-background" : "bg-background hover:bg-muted",
              )}
            >
              {DUTY_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{DUTY_HINT[type]}</p>
      </div>

      {/* who */}
      {needsPerson ? (
        person ? (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                <span className="text-muted-foreground">{person.rank}</span> {person.name}
              </p>
              <p className="text-xs text-muted-foreground">Own team: {home?.name}</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setPersonId(null)} aria-label="Change person">
              <X />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Who</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the roster" className="h-11 pl-9" autoFocus />
            </div>
            {matches.length > 0 && (
              <ul className="flex flex-col divide-y rounded-lg border">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setPersonId(p.id);
                        setSearch("");
                        if (campId === p.campId) setCampId("");
                      }}
                    >
                      <span>
                        <span className="text-muted-foreground">{p.rank}</span> {p.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{campById.get(p.campId)?.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!isSol && (
              <button type="button" className="w-fit text-xs text-primary" onClick={() => setOutsider(true)}>
                Not on our roster (another coy)?
              </button>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label="Rank">
              <Input value={rank} onChange={(e) => setRank(e.target.value.toUpperCase())} className="h-11" placeholder="CPL" />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="h-11" placeholder="TAN AH KOW" />
            </Field>
          </div>
          <button type="button" className="w-fit text-xs text-primary" onClick={() => setOutsider(false)}>
            Pick from our roster instead
          </button>
        </div>
      )}

      {/* where */}
      {isSol ? (
        person && sol ? (
          <div className="flex gap-2 rounded-xl bg-duty/10 p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-duty" />
            <p>
              Served with their own camp, so there&apos;s no camp to pick. {sol.note}
            </p>
          </div>
        ) : null
      ) : (
        <Field label="Serving at">
          <select value={campId} onChange={(e) => setCampId(e.target.value)} className="h-11 min-w-0 rounded-lg border bg-background px-3">
            <option value="">Choose a camp…</option>
            {campChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subunit} › {c.name}
                {c.onShift ? "" : " (off shift, not counted)"}
              </option>
            ))}
          </select>
          {person && home && (
            <p className="text-xs text-muted-foreground">
              Can&apos;t be their own team ({home.name}). They&apos;ll be marked absent there as “{type} @{" "}
              {campById.get(campId)?.name ?? "…"}”.
            </p>
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
        </Field>
        <Field label="Start time (optional)">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-11" />
        </Field>
        <Field label="End date">
          <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" />
        </Field>
        <Field label="End time (optional)">
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-11" />
        </Field>
        {isSol && <p className="col-span-2 -mt-1 text-xs text-muted-foreground">SOL prints its dates in the parade state.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Button size="lg" className="h-12 text-base" onClick={save} disabled={pending || !ready}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
        {duty && (
          <Button size="lg" variant="destructive" className="h-12" onClick={end} disabled={pending}>
            Finished serving: remove
          </Button>
        )}
      </div>
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
