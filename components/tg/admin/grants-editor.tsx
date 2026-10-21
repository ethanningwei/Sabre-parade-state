"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { addGrant, removeGrant } from "@/lib/wb/actions/admin";
import type { GrantRowView } from "@/lib/wb/admin-data";
import { onlyCampScope } from "@/lib/wb/domain/access";
import { ROLE_LABELS, WB_ROLES, type WbRole } from "@/lib/wb/domain/roles";
import type { SubunitWithCamps } from "@/lib/wb/roster";
import { bigButtonClass, inputClass } from "../ui";

const selectClass = inputClass;

/** The scope a role usually takes, picked first so the common case is one tap. */
const DEFAULT_SCOPE: Record<WbRole, "company" | "subunit" | "camp"> = {
  GC: "camp",
  PS: "subunit",
  PC: "subunit",
  "2IC": "company",
  OC: "company",
  CSM: "company",
  ASA: "company",
  ADMIN: "company",
};

export function GrantsEditor({
  grants,
  members,
  structure,
}: {
  grants: GrantRowView[];
  members: { id: string; label: string }[];
  structure: SubunitWithCamps[];
}) {
  const router = useRouter();
  const [memberId, setMemberId] = useState("");
  const [role, setRole] = useState<WbRole | "">("");
  const [scope, setScope] = useState("");
  const [pending, start] = useTransition();

  const pickRole = (r: WbRole | "") => {
    setRole(r);
    setScope(r && DEFAULT_SCOPE[r] === "company" ? "company" : "");
  };

  const byMember = new Map<string, GrantRowView[]>();
  for (const g of grants) byMember.set(g.memberId, [...(byMember.get(g.memberId) ?? []), g]);

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3 rounded-2xl bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!role) return;
          start(async () => {
            const res = await addGrant({ memberId, role, scope });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Granted");
            setMemberId("");
            pickRole("");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label>Member</Label>
          <select className={selectClass} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Pick someone registered</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Role</Label>
          <select className={selectClass} value={role} onChange={(e) => pickRole(e.target.value as WbRole | "")}>
            <option value="">Pick a role</option>
            {WB_ROLES.map((r) => (
              <option key={r} value={r}>
                {r} — {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Where</Label>
          <select className={selectClass} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Pick a scope</option>
            {/* a GC's grant is for his camp only (domain/access.ts) */}
            {!(role && onlyCampScope(role)) && (
              <>
                <option value="company">Whole company</option>
                <optgroup label="A platoon">
                  {structure.map((s) => (
                    <option key={s.id} value={`subunit:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              </>
            )}
            <optgroup label="One camp">
              {structure.flatMap((s) =>
                s.camps.map((c) => (
                  <option key={c.id} value={`camp:${c.id}`}>
                    {c.name} ({s.name})
                  </option>
                )),
              )}
            </optgroup>
          </select>
        </div>
        <Button type="submit" size="lg" className={bigButtonClass} disabled={pending || !memberId || !role || !scope}>
          {pending && <Loader2 className="animate-spin" />}
          Grant
        </Button>
      </form>

      <section className="flex flex-col gap-2">
        {byMember.size === 0 && <p className="text-sm text-muted-foreground">No grants yet.</p>}
        {[...byMember.values()].map((gs) => (
          <div key={gs[0].memberId} className="flex flex-col gap-2 rounded-2xl bg-card p-3">
            <p className="font-medium">{gs[0].memberLabel}</p>
            <div className="flex flex-wrap gap-2">
              {gs.map((g) => (
                <GrantChip key={g.id} g={g} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function GrantChip({ g }: { g: GrantRowView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border bg-muted pl-3 text-sm">
      {g.role} · {g.scope}
      <button
        type="button"
        aria-label={`Remove ${g.role} ${g.scope}`}
        disabled={pending}
        className="flex size-11 items-center justify-center rounded-full transition-colors duration-150 active:bg-background"
        onClick={() =>
          start(async () => {
            const res = await removeGrant(g.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Removed");
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
      </button>
    </span>
  );
}
