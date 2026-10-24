"use client";

import { Plus, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { addPlatoonAction, addSectionAction, removePlatoonAction, removeSectionAction, setCommanderAction } from "@/lib/wb/actions/changeover";
import { BigButton, Choice, ErrorBox, useAction } from "../form-bits";
import { TgSheet } from "../roster/tg-sheet";
import { fieldClass } from "../ui";

export interface StructureSection {
  id: string;
  name: string;
  men: { personId: string; label: string }[];
  sc: { personId: string; label: string; registered: boolean } | null;
}
export interface StructurePlatoon {
  id: string;
  name: string;
  pc: { personId: string; label: string } | null;
  ps: { personId: string; label: string }[];
  sections: StructureSection[];
}
export interface HqOption {
  personId: string;
  label: string;
  role: string;
}

type Picking = { kind: "sc"; platoon: StructurePlatoon; section: StructureSection } | { kind: "pcps"; platoon: StructurePlatoon };
/** What's being picked, by id: the sheet reads the platoon afresh after each refresh. */
type PickingIds = { kind: "sc"; platoonId: string; sectionId: string } | { kind: "pcps"; platoonId: string };

function resolve(ids: PickingIds | null, platoons: StructurePlatoon[]): Picking | null {
  const platoon = ids && platoons.find((p) => p.id === ids.platoonId);
  if (!ids || !platoon) return null;
  if (ids.kind === "pcps") return { kind: "pcps", platoon };
  const section = platoon.sections.find((s) => s.id === ids.sectionId);
  return section ? { kind: "sc", platoon, section } : null;
}

/**
 * The draft's platoons and sections, in parade-state order (mockup 2): add a
 * platoon or a section, delete one, Pick SC from the men placed in a section,
 * and each platoon's PC and PSes from COY HQ.
 */
export function StructureEditor({ platoons, hq }: { platoons: StructurePlatoon[]; hq: HqOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pickingIds, setPicking] = useState<PickingIds | null>(null);
  const picking = resolve(pickingIds, platoons);
  const [open, setOpen] = useState(false);
  const { pending, error, call } = useAction();
  const done = (msg?: string) => () => {
    if (msg) toast.success(msg);
    router.refresh();
  };
  const pick = (p: PickingIds) => {
    setPicking(p);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      {platoons.map((pl) => (
        <section key={pl.id} className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-2 px-1">
            <h2 className="text-[0.8125rem] leading-snug font-medium tracking-wide text-muted-foreground uppercase">
              {pl.name}
              <span className="block text-xs font-normal tracking-normal normal-case">
                PC {pl.pc?.label ?? "—"} · PS {pl.ps.map((p) => p.label).join(", ") || "—"}
              </span>
            </h2>
            <button type="button" onClick={() => pick({ kind: "pcps", platoonId: pl.id })} className="tg-press flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary active:bg-muted">
              <UserCog className="size-4" aria-hidden /> PC/PS
            </button>
          </div>
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {pl.sections.map((s) => (
              <div key={s.id} className="flex min-h-14 items-center gap-2 py-2 pr-2 pl-4">
                <Link href={`/tg/changeover/sections?section=${s.id}`} className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className={`text-xs ${s.sc ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                    {s.sc ? `SC ${s.sc.label}${s.sc.registered ? "" : " · not registered"}` : "No SC yet"} · {s.men.length} {s.men.length === 1 ? "man" : "men"}
                  </span>
                </Link>
                <button type="button" onClick={() => pick({ kind: "sc", platoonId: pl.id, sectionId: s.id })} className="tg-press min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium text-primary active:bg-muted">
                  {s.sc ? "Change SC" : "Pick SC"}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${s.name}`}
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Delete ${pl.name} ${s.name}?${s.men.length ? ` Its ${s.men.length} men go back to "not in a section".` : ""}`)) return;
                    call(() => removeSectionAction(s.id), done());
                  }}
                  className="tg-press flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            <button type="button" disabled={pending} onClick={() => call(() => addSectionAction(pl.id), done())} className="tg-press flex min-h-12 w-full items-center gap-2 px-4 text-left font-medium text-primary active:bg-muted">
              <Plus className="size-4" aria-hidden /> Add section
            </button>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete ${pl.name} and its ${pl.sections.length} sections from the draft?`)) return;
              call(() => removePlatoonAction(pl.id), done(`${pl.name} deleted from the draft.`));
            }}
            className="tg-press self-start rounded-lg px-1 py-2 text-xs text-muted-foreground active:bg-muted"
          >
            Delete {pl.name}
          </button>
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`PLATOON ${platoons.length + 1}`} aria-label="New platoon's name" className={fieldClass} autoCapitalize="characters" />
        <BigButton variant="secondary" pending={pending} onClick={() => call(() => addPlatoonAction(name || `PLATOON ${platoons.length + 1}`), (r) => (setName(""), done(`${r.name} added.`)()))}>
          <Plus aria-hidden /> Add platoon
        </BigButton>
      </section>
      <ErrorBox error={error} />

      {picking && <PickSheet key={picking.kind === "sc" ? picking.section.id : picking.platoon.id} picking={picking} hq={hq} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function PickSheet({ picking, hq, open, onOpenChange }: { picking: Picking; hq: HqOption[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const refresh = () => router.refresh();

  if (picking.kind === "sc") {
    const { platoon, section } = picking;
    return (
      <TgSheet open={open} onOpenChange={onOpenChange} title={`SC of ${platoon.name} ${section.name}`} description="From the men placed in this section. He gets the SC role when you switch.">
        <div className="flex flex-col gap-2">
          {section.men.length === 0 && <p className="text-sm text-muted-foreground">Nobody is placed here yet. Place men first.</p>}
          {section.men.map((m) => (
            <Choice key={m.personId} on={section.sc?.personId === m.personId} onClick={() => call(() => setCommanderAction({ role: "SC", scopeId: section.id, personId: m.personId }), () => (refresh(), onOpenChange(false)))}>
              {m.label}
            </Choice>
          ))}
          {section.sc && (
            <BigButton variant="outline" pending={pending} onClick={() => call(() => setCommanderAction({ role: "SC", scopeId: section.id, personId: null }), () => (refresh(), onOpenChange(false)))}>
              No SC for now
            </BigButton>
          )}
        </div>
        <ErrorBox error={error} />
      </TgSheet>
    );
  }

  const { platoon } = picking;
  // PCs and PSes first: that's who they'll be
  const sorted = [...hq].sort((a, b) => Number(!["PC", "PS"].includes(a.role)) - Number(!["PC", "PS"].includes(b.role)));
  return (
    <TgSheet open={open} onOpenChange={onOpenChange} title={`${platoon.name}'s PC and PS`} description="From COY HQ, where they sit. They get the role for this platoon when you switch; their Vigilance platoon roles end.">
      <p className="text-sm font-medium">PC</p>
      <div className="flex flex-col gap-2">
        {sorted.map((h) => (
          <Choice key={h.personId} on={platoon.pc?.personId === h.personId} onClick={() => call(() => setCommanderAction({ role: "PC", scopeId: platoon.id, personId: platoon.pc?.personId === h.personId ? null : h.personId }), refresh)}>
            {h.label} <span className="text-xs text-muted-foreground">{h.role}</span>
          </Choice>
        ))}
      </div>
      <p className="text-sm font-medium">PS (one or more)</p>
      <div className="flex flex-col gap-2">
        {sorted.map((h) => {
          const on = platoon.ps.some((p) => p.personId === h.personId);
          return (
            <Choice key={h.personId} on={on} onClick={() => call(() => setCommanderAction({ role: "PS", scopeId: platoon.id, personId: h.personId, remove: on }), refresh)}>
              {h.label} <span className="text-xs text-muted-foreground">{h.role}</span>
            </Choice>
          );
        })}
      </div>
      <ErrorBox error={error} />
      <BigButton pending={pending} onClick={() => onOpenChange(false)}>
        Done
      </BigButton>
    </TgSheet>
  );
}
