"use client";

import { ChevronRight, Save, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { addPersonAction, editPersonAction } from "@/lib/wb/actions/roster";
import { roleOf } from "@/lib/wb/domain/roles";
import { BigButton, ErrorBox, useAction } from "../form-bits";
import { filledIn, PersonFields, rolesOf, type CampOption, type PersonValues } from "./person-fields";
import { TgSheet } from "./tg-sheet";

export interface EditablePerson {
  personId: string;
  rank: string;
  name: string;
  role: string;
  campId: string;
  /** his Person history opens for this viewer */
  history: boolean;
  /** Remove from roster is this viewer's to do */
  remove: boolean;
}

/**
 * + Add person (no `person`) or Edit (rank, name, camp, role) on Roster.
 * Removing him goes through Person history, where the sheet counts what
 * removal takes with him.
 */
export function PersonSheet({ open, onOpenChange, camps, person }: { open: boolean; onOpenChange: (open: boolean) => void; camps: CampOption[]; person?: EditablePerson }) {
  const router = useRouter();
  const camp = camps.find((c) => c.id === person?.campId) ?? camps[0];
  // "GUARD COMM" is shown as GC when it maps to a choice; anything else is kept as v1 has it
  const mapped = person && camp && rolesOf(camp).includes(roleOf(person.role)) ? roleOf(person.role) : null;
  const keepRole = person && !mapped ? person.role : undefined;
  const [value, setValue] = useState<PersonValues>(() => ({
    rank: person?.rank ?? "",
    name: person?.name ?? "",
    campId: camp?.id ?? "",
    role: mapped ?? person?.role ?? "",
  }));
  const { pending, error, call } = useAction();

  const save = () =>
    person
      ? call(
          // a role shown as GC because v1 has "GUARD COMM" goes back as v1 has it, unless it was changed
          () => editPersonAction(person.personId, { ...value, role: value.role === mapped ? person.role : value.role }),
          (done) => {
            toast.success(!done.changed ? "Nothing to change." : done.moved ? `${done.label} moved to ${done.campName}.` : `${done.label} saved.`);
            onOpenChange(false);
            router.refresh();
          },
        )
      : call(
          () => addPersonAction(value),
          (done) => {
            toast.success(`${done.label} is on the parade state.`);
            onOpenChange(false);
            router.refresh();
          },
        );

  return (
    <TgSheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? `${person.rank} ${person.name}` : "Add person"}
      description={person ? "Changes go straight onto the parade state." : "Someone who isn't on the parade state yet. When he registers, Sabre finds him by name."}
    >
      <PersonFields value={value} onChange={setValue} camps={camps} keepRole={keepRole} />
      <ErrorBox error={error} />
      <BigButton pending={pending} disabled={!filledIn(value, keepRole)} onClick={save}>
        {person ? (
          <>
            <Save aria-hidden /> Save
          </>
        ) : (
          <>
            <UserPlus aria-hidden /> Add to the parade state
          </>
        )}
      </BigButton>
      {person && (person.history || person.remove) && (
        <div className="tg-rows mt-2 overflow-hidden rounded-2xl bg-card">
          {person.history && <SheetLink href={`/tg/people/${person.personId}`} label="History" hint="Everything on his timeline" />}
          {person.remove && (
            <SheetLink href={`/tg/people/${person.personId}?from=roster#remove`} label="Remove from roster…" hint="ORD, posted out: shows what it takes with him first" destructive />
          )}
        </div>
      )}
    </TgSheet>
  );
}

function SheetLink({ href, label, hint, destructive }: { href: string; label: string; hint: string; destructive?: boolean }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-150 active:bg-muted">
      {destructive && <UserMinus className="size-4 shrink-0 text-destructive" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`font-medium ${destructive ? "text-destructive" : ""}`}>{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}
