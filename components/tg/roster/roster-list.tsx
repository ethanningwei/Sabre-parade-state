"use client";

import { ChevronRight, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { BigButton } from "../form-bits";
import { fieldClass } from "../ui";
import type { CampOption } from "./person-fields";
import { PersonSheet, type EditablePerson } from "./person-sheet";

export interface ListCamp {
  id: string;
  name: string;
  subunitName: string;
  /** Person history / Remove from roster, for this viewer, for the men of this camp */
  history: boolean;
  remove: boolean;
  people: { personId: string; rank: string; name: string; role: string; registered: boolean }[];
}

/**
 * The roster in the viewer's scope: + Add person, a search, "Not registered"
 * as a filter, and one group per camp. Tap a man to edit him. With more than
 * one camp, each starts folded unless a search is on.
 */
export function RosterList({ camps, options, selfId }: { camps: ListCamp[]; options: CampOption[]; selfId: string | null }) {
  const [q, setQ] = useState("");
  const [onlyUnregistered, setOnlyUnregistered] = useState(false);
  // kept after closing, so the sheet can slide away; `open` says whether it's up
  const [editing, setEditing] = useState<EditablePerson | "new" | null>(null);
  const [open, setOpen] = useState(false);
  // a new key each time, so every sheet opens with his values (or empty)
  const [opened, setOpened] = useState(0);
  const edit = (p: EditablePerson | "new") => {
    setEditing(p);
    setOpened((n) => n + 1);
    setOpen(true);
  };
  const query = q.trim().toUpperCase();
  const unregistered = camps.reduce((n, c) => n + c.people.filter((p) => !p.registered).length, 0);
  const shown = camps.map((c) => ({
    ...c,
    people: c.people.filter((p) => (!onlyUnregistered || !p.registered) && (!query || `${p.rank} ${p.name}`.includes(query))),
  }));
  const filtering = !!query || onlyUnregistered;
  const hits = shown.reduce((n, c) => n + c.people.length, 0);
  const folded = camps.length > 1 && !filtering;

  return (
    <div className="flex flex-col gap-3">
      {options.length > 0 && (
        <BigButton variant="secondary" onClick={() => edit("new")}>
          <UserPlus aria-hidden /> Add person
        </BigButton>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or rank" aria-label="Search name or rank" className={`${fieldClass} pl-10`} autoCapitalize="characters" />
      </div>
      {unregistered > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <button
            type="button"
            aria-pressed={onlyUnregistered}
            onClick={() => setOnlyUnregistered((v) => !v)}
            className={`tg-press min-h-9 rounded-full border px-3.5 text-sm ${onlyUnregistered ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-card active:bg-muted"}`}
          >
            Not registered · {unregistered}
          </button>
        </div>
      )}
      {filtering && (
        <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
          {hits === 0 ? "Nobody matches." : `${hits} ${hits === 1 ? "man" : "men"}`}
        </p>
      )}

      {shown
        .filter((c) => !filtering || c.people.length > 0)
        .map((c) => {
          const rows = (
            <div className={`tg-rows ${folded ? "tg-reveal border-t" : "overflow-hidden rounded-2xl bg-card"}`}>
              {c.people.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nobody yet.</p>
              ) : (
                c.people.map((p) => (
                  <button
                    key={p.personId}
                    type="button"
                    onClick={() => edit({ personId: p.personId, rank: p.rank, name: p.name, role: p.role, campId: c.id, history: c.history, remove: c.remove && p.personId !== selfId })}
                    className="tg-press flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">
                        {p.rank} {p.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{[p.role, !p.registered && "Not registered"].filter(Boolean).join(" · ") || " "}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  </button>
                ))
              )}
            </div>
          );
          const title = c.name === c.subunitName ? c.name : `${c.name} · ${c.subunitName}`;
          return folded ? (
            <details key={c.id} className="group overflow-hidden rounded-2xl bg-card">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium transition-colors duration-150 active:bg-muted [&::-webkit-details-marker]:hidden">
                {title} · {c.people.length}
                <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
              </summary>
              {rows}
            </details>
          ) : (
            <section key={c.id} className="flex flex-col gap-1.5">
              <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {title} · {c.people.length}
              </h2>
              {rows}
            </section>
          );
        })}

      {editing && (
        <PersonSheet
          key={opened}
          open={open}
          onOpenChange={setOpen}
          camps={options}
          person={editing === "new" ? undefined : editing}
        />
      )}
    </div>
  );
}
