"use client";

import { Link2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { addToRosterAction, linkToRosterAction } from "@/lib/wb/actions/roster";
import { RANKS, rolesFor } from "@/lib/wb/domain/roles";
import { fieldClass, inputClass } from "../ui";
import { BigButton, Choice, ErrorBox, Field, useAction } from "../form-bits";
import { TgSheet } from "./tg-sheet";

export interface CampOption {
  id: string;
  name: string;
  subunitName: string;
  isHq: boolean;
}

export interface Candidate {
  personId: string;
  label: string;
  campName: string;
}

/**
 * One "Not on the roster yet" row on Gaps: who he says he is, with Add to
 * roster (a v1 person from what he typed, checked by the PS) and, when the
 * roster has a similar unregistered name in his camp, Link to existing.
 */
export function WaitingRow({
  memberId,
  label,
  sub,
  self,
  campId,
  camps,
  candidates,
}: {
  memberId: string;
  label: string;
  sub: string;
  self: { rank: string | null; name: string | null; role: string | null };
  campId: string | null;
  camps: CampOption[];
  candidates: Candidate[];
}) {
  const [open, setOpen] = useState<null | "add" | "link">(null);
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className={`grid gap-2 ${candidates.length ? "grid-cols-2" : "grid-cols-1"}`}>
        <BigButton variant="secondary" onClick={() => setOpen("add")}>
          <UserPlus aria-hidden /> Add to roster
        </BigButton>
        {candidates.length > 0 && (
          <BigButton variant="outline" onClick={() => setOpen("link")}>
            <Link2 aria-hidden /> Link to existing
          </BigButton>
        )}
      </div>
      <AddSheet open={open === "add"} onOpenChange={(o) => setOpen(o ? "add" : null)} memberId={memberId} label={label} self={self} campId={campId} camps={camps} />
      {candidates.length > 0 && <LinkSheet open={open === "link"} onOpenChange={(o) => setOpen(o ? "link" : null)} memberId={memberId} label={label} candidates={candidates} />}
    </div>
  );
}

function AddSheet({
  open,
  onOpenChange,
  memberId,
  label,
  self,
  campId: initialCamp,
  camps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  label: string;
  self: { rank: string | null; name: string | null; role: string | null };
  campId: string | null;
  camps: CampOption[];
}) {
  const router = useRouter();
  const startCamp = camps.some((c) => c.id === initialCamp) ? initialCamp! : (camps[0]?.id ?? "");
  const [rank, setRank] = useState(self.rank ?? "");
  const [name, setName] = useState((self.name ?? "").toUpperCase());
  const [campId, setCampId] = useState(startCamp);
  const camp = camps.find((c) => c.id === campId);
  const roles = camp ? rolesFor(camp.isHq) : [];
  const [role, setRole] = useState(self.role && roles.includes(self.role) ? self.role : "");
  const { pending, error, call } = useAction();

  const save = () =>
    call(
      () => addToRosterAction({ memberId, campId, rank, name, role }),
      (done) => {
        toast.success(`${done.label} is on the parade state. He's been told.`);
        onOpenChange(false);
        router.refresh();
      },
    );

  return (
    <TgSheet open={open} onOpenChange={onOpenChange} title="Add to roster" description={`What ${label} registered with. Check it against the parade state before you add him.`}>
      <Field label="Rank">
        <select className={inputClass} value={rank} onChange={(e) => setRank(e.target.value)}>
          <option value="">Pick one</option>
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name, as on the parade state">
        <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} autoCapitalize="characters" className={fieldClass} />
      </Field>
      <Field label="Camp">
        <select
          className={inputClass}
          value={campId}
          onChange={(e) => {
            setCampId(e.target.value);
            const next = camps.find((c) => c.id === e.target.value);
            if (next && !rolesFor(next.isHq).includes(role)) setRole("");
          }}
        >
          {camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.subunitName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Role">
        <div className="grid grid-cols-3 gap-2">
          {roles.map((r) => (
            <Choice key={r} on={role === r} onClick={() => setRole(r)}>
              {r}
            </Choice>
          ))}
        </div>
      </Field>
      <ErrorBox error={error} />
      <BigButton pending={pending} disabled={!rank || name.trim().length < 2 || !campId || !role} onClick={save}>
        <UserPlus aria-hidden /> Add to the parade state
      </BigButton>
    </TgSheet>
  );
}

function LinkSheet({
  open,
  onOpenChange,
  memberId,
  label,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  label: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const [picked, setPicked] = useState<string | null>(null);

  const link = (personId: string) => {
    setPicked(personId);
    call(
      () => linkToRosterAction(memberId, personId),
      (done) => {
        toast.success(`${label} is now ${done.label}. He's been told.`);
        onOpenChange(false);
        router.refresh();
      },
    );
  };

  return (
    <TgSheet open={open} onOpenChange={onOpenChange} title="Link to existing" description={`Already on the parade state under another spelling? Pick who ${label} is.`}>
      <ul className="tg-rows overflow-hidden rounded-2xl bg-card">
        {candidates.map((c) => (
          <li key={c.personId}>
            <button
              type="button"
              disabled={pending}
              onClick={() => link(c.personId)}
              className="tg-press flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted disabled:opacity-60"
            >
              <span className="flex-1">
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.campName} · not registered yet</span>
              </span>
              <Link2 className={`size-4 shrink-0 text-muted-foreground ${pending && picked === c.personId ? "animate-pulse" : ""}`} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <ErrorBox error={error} />
    </TgSheet>
  );
}
