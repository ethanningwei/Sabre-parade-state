"use client";

import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";

// The roster in a commander's scope, searchable. Links to a person's history,
// or (with `picked`) a multi-select for Add for several men.

export interface PersonItem {
  personId: string;
  rank: string;
  name: string;
  campName: string;
  subunitName: string;
}

const SHOW_MAX = 60;

export function PeopleList({
  people,
  picked,
  onToggle,
}: {
  people: PersonItem[];
  picked?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toUpperCase();
  const hits = query ? people.filter((p) => `${p.rank} ${p.name} ${p.campName}`.toUpperCase().includes(query)) : people;
  const shown = hits.slice(0, SHOW_MAX);

  return (
    <div className="flex flex-col gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or camp" className="h-11 text-base" autoCapitalize="characters" />
      <p className="text-xs text-muted-foreground">
        {hits.length > SHOW_MAX ? `Showing ${SHOW_MAX} of ${hits.length}. Type more of a name.` : `${hits.length} people`}
      </p>
      {shown.map((p) => {
        const label = (
          <span className="flex flex-1 flex-col">
            <span className="font-medium">
              {p.rank} {p.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {p.campName} · {p.subunitName}
            </span>
          </span>
        );
        if (!picked || !onToggle) {
          return (
            <Link key={p.personId} href={`/tg/people/${p.personId}`} className="flex min-h-12 items-center gap-3 rounded-lg border bg-card px-3 py-2 active:bg-muted">
              {label}
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          );
        }
        const on = picked.has(p.personId);
        return (
          <button
            key={p.personId}
            type="button"
            onClick={() => onToggle(p.personId)}
            aria-pressed={on}
            className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left active:bg-muted ${on ? "border-primary bg-primary/10" : "bg-card"}`}
          >
            <span className={`flex size-5 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>
              {on && <Check className="size-3.5" />}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
