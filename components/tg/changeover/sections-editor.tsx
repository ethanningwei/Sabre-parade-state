"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { placeCampAction, placeMenAction, unplaceMenAction } from "@/lib/wb/actions/changeover";
import { BigButton, ErrorBox, useAction } from "../form-bits";
import { tick } from "../webapp";
import { inputClass } from "../ui";

export interface SectionsMan {
  personId: string;
  label: string;
  role: string;
  campId: string;
  campName: string;
  sectionId: string | null;
}
export interface SectionsPlatoon {
  id: string;
  name: string;
  sections: { id: string; name: string; count: number }[];
}

const chip = (on: boolean) =>
  `tg-press min-h-9 shrink-0 rounded-full border px-3.5 text-sm ${on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-card active:bg-muted"}`;

/**
 * Assign men to sections (mockup 3): pick a section, filter the men not in a
 * section yet by their camp today, tick and add, or move a whole camp in.
 * The men already in the section can be taken out again.
 */
export function SectionsEditor({ platoons, sectionId, men, placed, total }: { platoons: SectionsPlatoon[]; sectionId: string; men: SectionsMan[]; placed: number; total: number }) {
  const router = useRouter();
  const [chosenCamp, setCampId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { pending, error, call } = useAction();
  const platoon = platoons.find((p) => p.sections.some((s) => s.id === sectionId))!;
  const section = platoon.sections.find((s) => s.id === sectionId)!;
  const here = men.filter((m) => m.sectionId === sectionId);
  const waiting = men.filter((m) => !m.sectionId);
  const camps = [...new Map(waiting.map((m) => [m.campId, m.campName])).entries()].map(([id, name]) => ({ id, name, n: waiting.filter((m) => m.campId === id).length }));
  // a camp whose men have all been placed drops out of the filter
  const campId = camps.some((c) => c.id === chosenCamp) ? chosenCamp : null;
  const shown = campId ? waiting.filter((m) => m.campId === campId) : waiting;
  const campName = camps.find((c) => c.id === campId)?.name;
  const go = (id: string) => router.replace(`/tg/changeover/sections?section=${id}`, { scroll: false });
  const after = (msg: string) => {
    toast.success(msg);
    setPicked(new Set());
    router.refresh();
  };
  const toggle = (id: string) => {
    tick();
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-col gap-2 px-1">
        <p className="text-right text-sm tabular-nums">
          <strong>{placed}</strong> <span className="text-muted-foreground">/ {total} placed</span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${placed} of ${total} placed`}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (placed / total) * 100 : 0}%` }} />
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        Platoon
        <select className={inputClass} value={platoon.id} onChange={(e) => go(platoons.find((p) => p.id === e.target.value)!.sections[0]?.id ?? sectionId)}>
          {platoons
            .filter((p) => p.sections.length)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Section">
        {platoon.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === sectionId}
            onClick={() => go(s.id)}
            className={`tg-press flex min-h-13 flex-col items-center justify-center rounded-xl border text-sm ${s.id === sectionId ? "border-primary bg-primary/10 font-semibold" : "border-border bg-card font-medium active:bg-muted"}`}
          >
            {s.name}
            <span className={`text-xs ${s.id === sectionId ? "text-primary" : "text-muted-foreground"}`}>{s.count} men</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Not in a section yet · {waiting.length}</h2>
          <Link href="/tg/changeover/paste" className="text-sm font-medium text-primary">
            Paste a list
          </Link>
        </div>
        {camps.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button type="button" className={chip(!campId)} aria-pressed={!campId} onClick={() => setCampId(null)}>
              All camps
            </button>
            {camps.map((c) => (
              <button key={c.id} type="button" className={chip(c.id === campId)} aria-pressed={c.id === campId} onClick={() => setCampId(c.id)}>
                From {c.name} · {c.n}
              </button>
            ))}
          </div>
        )}
        {campId && (
          <BigButton variant="outline" pending={pending} onClick={() => call(() => placeCampAction(campId, sectionId), (r) => after(`${r.placed} moved to ${r.section}.`))}>
            Move all of {campName} here
          </BigButton>
        )}
        <div className="tg-rows overflow-hidden rounded-2xl bg-card">
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Everyone has a section.</p>}
          {shown.map((m) => {
            const on = picked.has(m.personId);
            return (
              <button key={m.personId} type="button" role="checkbox" aria-checked={on} data-haptic="own" onClick={() => toggle(m.personId)} className="tg-press flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted">
                <span className={`flex size-[22px] shrink-0 items-center justify-center rounded-md ${on ? "bg-primary text-primary-foreground" : "border-2 border-muted-foreground/40"}`} aria-hidden>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.campName} · {m.role || "—"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">
          In {platoon.name} {section.name} · {here.length}
        </h2>
        <div className="tg-rows overflow-hidden rounded-2xl bg-card">
          {here.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nobody yet.</p>}
          {here.map((m) => (
            <div key={m.personId} className="flex min-h-13 items-center gap-3 py-2 pr-2 pl-4">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">from {m.campName}</span>
              </span>
              <button type="button" disabled={pending} onClick={() => call(() => unplaceMenAction([m.personId]), (r) => after(r.unplaced ? `${m.label} taken out.` : "Nothing to change."))} className="tg-press min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-primary active:bg-muted">
                Take out
              </button>
            </div>
          ))}
        </div>
      </section>
      <ErrorBox error={error} />

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-2xl bg-gradient-to-t from-background from-60% to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <BigButton pending={pending} disabled={!picked.size} onClick={() => call(() => placeMenAction([...picked], sectionId), (r) => after(`${r.placed} added to ${r.section}.`))}>
          {picked.size ? `Add ${picked.size} to ${section.name}` : `Tick men to add to ${section.name}`}
        </BigButton>
      </div>
    </div>
  );
}
