"use client";

import { Check, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { fieldClass } from "./ui";
import { tick } from "./webapp";

// The roster in a commander's scope, searchable. Links to a person's history
// (or `hrefBase` + his id: the man picker of Report for your men), or (with
// `picked`) a multi-select for Add for several men.

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
  hrefBase = "/tg/people/",
}: {
  people: PersonItem[];
  hrefBase?: string;
  picked?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toUpperCase();
  const hits = query ? people.filter((p) => `${p.rank} ${p.name} ${p.campName}`.toUpperCase().includes(query)) : people;
  const shown = hits.slice(0, SHOW_MAX);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or camp" aria-label="Search name or camp" className={`${fieldClass} pl-10`} autoCapitalize="characters" />
      </div>
      <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
        {hits.length > SHOW_MAX ? `Showing ${SHOW_MAX} of ${hits.length}. Type more of a name.` : `${hits.length} people`}
      </p>
      {shown.length > 0 && (
        <div className="tg-rows overflow-hidden rounded-2xl bg-card">
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
                <Link key={p.personId} href={`${hrefBase}${p.personId}`} className="flex min-h-13 items-center gap-3 px-4 py-2 transition-colors duration-150 active:bg-muted">
                  {label}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                </Link>
              );
            }
            const on = picked.has(p.personId);
            return (
              <button
                key={p.personId}
                type="button"
                onClick={() => {
                  tick();
                  onToggle(p.personId);
                }}
                aria-pressed={on}
                className={`flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 active:bg-muted ${on ? "bg-primary/10" : ""}`}
              >
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150 ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`} aria-hidden>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
