"use client";

import { Loader2, Plus, Search, UserMinus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { removePerson, savePerson } from "@/lib/actions/admin";

interface Camp {
  id: string;
  name: string;
  subunit: string;
}
interface Person {
  id: string;
  rank: string;
  name: string;
  role: string;
  campId: string;
}

export function PeopleEditor({ camps, people }: { camps: Camp[]; people: Person[] }) {
  const [campFilter, setCampFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const campName = new Map(camps.map((c) => [c.id, `${c.subunit} › ${c.name}`]));

  const visible = people.filter(
    (p) =>
      (campFilter === "all" || p.campId === campFilter) &&
      (!query || `${p.rank} ${p.name}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <select
          value={campFilter}
          onChange={(e) => setCampFilter(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border bg-card px-3"
        >
          <option value="all">All camps</option>
          {camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.subunit} › {c.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setEditing("new")} className="h-10">
          <Plus /> Add
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-10 bg-card pl-9 dark:bg-card" />
      </div>
      <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
        {visible.map((p) => (
          <li key={p.id}>
            <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50" onClick={() => setEditing(p)}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">
                  <span className="text-muted-foreground">{p.rank || "—"}</span> {p.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {campName.get(p.campId)}
                  {p.role && ` · ${p.role}`}
                </p>
              </div>
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nobody found.</li>}
      </ul>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-2xl gap-0 overflow-y-auto rounded-t-2xl">
          {editing !== null && (
            <PersonForm
              key={editing === "new" ? "new" : editing.id}
              person={editing === "new" ? null : editing}
              camps={camps}
              defaultCampId={campFilter !== "all" ? campFilter : camps[0]?.id}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PersonForm({
  person,
  camps,
  defaultCampId,
  onDone,
}: {
  person: Person | null;
  camps: Camp[];
  defaultCampId: string | undefined;
  onDone: () => void;
}) {
  const [rank, setRank] = useState(person?.rank ?? "");
  const [name, setName] = useState(person?.name ?? "");
  const [role, setRole] = useState(person?.role ?? "");
  const [campId, setCampId] = useState(person?.campId ?? defaultCampId ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <SheetHeader className="px-0">
        <SheetTitle className="text-lg">{person ? "Edit person" : "Add person"}</SheetTitle>
      </SheetHeader>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Rank</Label>
          <Input value={rank} onChange={(e) => setRank(e.target.value.toUpperCase())} className="h-11" placeholder="PTE" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="h-11" placeholder="TAN AH KOW" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Role (optional, not printed)</Label>
        <Input value={role} onChange={(e) => setRole(e.target.value)} className="h-11" placeholder="GUARD COMM / CBT / SVC" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Camp</Label>
        <select value={campId} onChange={(e) => setCampId(e.target.value)} className="h-11 min-w-0 rounded-lg border bg-background px-3">
          {camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.subunit} › {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        size="lg"
        className="h-12"
        disabled={pending || !rank.trim() || !name.trim() || !campId}
        onClick={() =>
          startTransition(async () => {
            const res = await savePerson({ personId: person?.id, campId, rank, name, role });
            if (res.ok) {
              toast.success(person ? "Saved" : `${rank} ${name} added`);
              onDone();
            } else toast.error(res.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        Save
      </Button>
      {person && (
        <Button variant="destructive" disabled={pending} onClick={() => setConfirmRemove(true)}>
          <UserMinus /> Remove from roster
        </Button>
      )}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {person?.rank} {person?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              For people who have ORD-ed or been posted out. They stop counting towards strength. Their history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  const res = await removePerson(person!.id);
                  if (res.ok) {
                    toast.success("Removed");
                    onDone();
                  } else toast.error(res.error);
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
