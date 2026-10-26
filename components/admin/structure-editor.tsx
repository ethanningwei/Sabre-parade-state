"use client";

import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  createCamp,
  createSubunit,
  deleteCamp,
  deleteSubunit,
  moveCamp,
  moveSubunit,
  renameSubunit,
  updateCamp,
} from "@/lib/actions/admin";
import type { ActionResult } from "@/lib/actions/shared";

interface Sub {
  id: string;
  name: string;
  isHq: boolean;
  camps: { id: string; name: string; post: string; people: number }[];
}

type Editing =
  | { kind: "new-subunit" }
  | { kind: "subunit"; sub: Sub }
  | { kind: "new-camp"; sub: Sub }
  | { kind: "camp"; sub: Sub; camp: Sub["camps"][number] };

export function StructureEditor({ subunits }: { subunits: Sub[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();

  function act(fn: () => Promise<ActionResult<unknown>>, ok?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (ok) toast.success(ok);
        setEditing(null);
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {subunits.map((s, si) => (
        <section key={s.id} className="flex flex-col gap-2 rounded-2xl bg-card p-3">
          <div className="flex items-center gap-1">
            <p className="flex-1 font-semibold">
              {s.name}
              {s.isHq && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">HQ</span>}
            </p>
            <Button variant="ghost" size="icon-sm" disabled={pending || si === 0} onClick={() => act(() => moveSubunit(s.id, -1))} aria-label="Move up">
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending || si === subunits.length - 1}
              onClick={() => act(() => moveSubunit(s.id, 1))}
              aria-label="Move down"
            >
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ kind: "subunit", sub: s })} aria-label="Edit">
              <Pencil />
            </Button>
          </div>
          <ul className="flex flex-col divide-y rounded-lg border">
            {s.camps.map((c, ci) => (
              <li key={c.id} className="flex items-center gap-1 px-3 py-1.5">
                <button className="flex-1 py-1.5 text-left text-sm" onClick={() => setEditing({ kind: "camp", sub: s, camp: c })}>
                  {c.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {c.people} people{c.post !== c.name && ` · camp ${c.post}`}
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" disabled={pending || ci === 0} onClick={() => act(() => moveCamp(c.id, -1))} aria-label="Move up">
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || ci === s.camps.length - 1}
                  onClick={() => act(() => moveCamp(c.id, 1))}
                  aria-label="Move down"
                >
                  <ArrowDown />
                </Button>
              </li>
            ))}
            {s.camps.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">No camps yet</li>}
          </ul>
          {!(s.isHq && s.camps.length >= 1) && (
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing({ kind: "new-camp", sub: s })}>
              <Plus /> Add camp
            </Button>
          )}
        </section>
      ))}
      <Button variant="outline" onClick={() => setEditing({ kind: "new-subunit" })}>
        <Plus /> Add subunit
      </Button>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-2xl gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          {editing && (
            <EditForm key={JSON.stringify(editing)} editing={editing} subunits={subunits} pending={pending} act={act} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EditForm({
  editing,
  subunits,
  pending,
  act,
}: {
  editing: Editing;
  subunits: Sub[];
  pending: boolean;
  act: (fn: () => Promise<ActionResult<unknown>>, ok?: string) => void;
}) {
  const initialName = editing.kind === "subunit" ? editing.sub.name : editing.kind === "camp" ? editing.camp.name : "";
  const [name, setName] = useState(initialName);
  const [isHq, setIsHq] = useState(false);
  const [subunitId, setSubunitId] = useState(editing.kind === "camp" || editing.kind === "new-camp" ? editing.sub.id : "");
  const [post, setPost] = useState(editing.kind === "camp" && editing.camp.post !== editing.camp.name ? editing.camp.post : "");

  const title = {
    "new-subunit": "Add subunit",
    subunit: "Edit subunit",
    "new-camp": `Add camp to ${editing.kind === "new-camp" ? editing.sub.name : ""}`,
    camp: "Edit camp",
  }[editing.kind];

  function save() {
    switch (editing.kind) {
      case "new-subunit":
        return act(() => createSubunit({ name, isHq }), "Subunit added");
      case "subunit":
        return act(() => renameSubunit(editing.sub.id, name), "Saved");
      case "new-camp":
        return act(() => createCamp({ subunitId: editing.sub.id, name, post }), "Camp added");
      case "camp":
        return act(() => updateCamp({ campId: editing.camp.id, name, subunitId, post }), "Saved");
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <SheetHeader className="px-0">
        <SheetTitle className="text-lg">{title}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Name (printed exactly as typed)</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11"
          placeholder={editing.kind.includes("subunit") ? "PLATOON 9" : "SFT A"}
          autoFocus
        />
      </div>
      {editing.kind === "new-subunit" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isHq} onChange={(e) => setIsHq(e.target.checked)} className="size-4" />
          This is the COY HQ (one camp, printed as its own block)
        </label>
      )}
      {(editing.kind === "camp" || editing.kind === "new-camp") && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Physical camp (for teams that take turns)</Label>
          <Input value={post} onChange={(e) => setPost(e.target.value)} className="h-11" placeholder="e.g. SFT for SFT A and SFT B" />
          <p className="text-xs text-muted-foreground">
            Teams with the same physical camp take turns on shift. SOL is counted under whichever team is on shift. Leave
            blank if this camp has only one team.
          </p>
        </div>
      )}
      {editing.kind === "camp" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Subunit</Label>
          <select value={subunitId} onChange={(e) => setSubunitId(e.target.value)} className="h-11 min-w-0 rounded-lg border bg-background px-3">
            {subunits.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button size="lg" className="h-12" onClick={save} disabled={pending || !name.trim()}>
        {pending && <Loader2 className="animate-spin" />}
        Save
      </Button>
      {editing.kind === "subunit" && (
        <Button
          variant="destructive"
          disabled={pending || editing.sub.camps.length > 0}
          onClick={() => act(() => deleteSubunit(editing.sub.id), "Subunit deleted")}
        >
          <Trash2 /> Delete subunit {editing.sub.camps.length > 0 && "(move its camps first)"}
        </Button>
      )}
      {editing.kind === "camp" && (
        <Button
          variant="destructive"
          disabled={pending || editing.camp.people > 0}
          onClick={() => act(() => deleteCamp(editing.camp.id), "Camp deleted")}
        >
          <Trash2 /> Delete camp {editing.camp.people > 0 && "(move its people first)"}
        </Button>
      )}
    </div>
  );
}
