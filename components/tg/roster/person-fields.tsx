"use client";

import { Input } from "@/components/ui/input";
import { RANKS, rolesFor } from "@/lib/wb/domain/roles";
import { fieldClass, inputClass } from "../ui";
import { Choice, Field } from "../form-bits";

export interface CampOption {
  id: string;
  name: string;
  subunitName: string;
  isHq: boolean;
}

export interface PersonValues {
  rank: string;
  name: string;
  campId: string;
  role: string;
}

/** Ready to send: a rank, a name, a camp and a role (or the one v1 has, left alone, even blank). */
export const filledIn = (v: PersonValues, keepRole?: string) => !!v.rank && v.name.trim().length >= 2 && !!v.campId && (!!v.role || v.role === keepRole);

/**
 * Rank, name, camp and role: what Add to roster, + Add person and Edit ask.
 * `keepRole` is the role v1 has for him when it isn't one of the camp's
 * choices ("GUARD COMM" from the old roster): offered as is, so an edit of his
 * rank doesn't rewrite it.
 */
export function PersonFields({ value, onChange, camps, keepRole }: { value: PersonValues; onChange: (v: PersonValues) => void; camps: CampOption[]; keepRole?: string }) {
  const camp = camps.find((c) => c.id === value.campId);
  const roles = camp ? rolesFor(camp.isHq) : [];
  const set = (patch: Partial<PersonValues>) => onChange({ ...value, ...patch });
  const legacy = keepRole && !roles.includes(keepRole) ? keepRole : null;
  return (
    <>
      <Field label="Rank">
        <select className={inputClass} value={value.rank} onChange={(e) => set({ rank: e.target.value })}>
          <option value="">Pick one</option>
          {/* a rank v1 has that isn't on the list stays visible until it's changed */}
          {value.rank && !(RANKS as readonly string[]).includes(value.rank) && <option value={value.rank}>{value.rank}</option>}
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name, as on the parade state">
        <Input value={value.name} onChange={(e) => set({ name: e.target.value.toUpperCase() })} autoCapitalize="characters" className={fieldClass} />
      </Field>
      <Field label="Camp">
        <select
          className={inputClass}
          value={value.campId}
          onChange={(e) => {
            const next = camps.find((c) => c.id === e.target.value);
            set({ campId: e.target.value, ...(next && value.role !== legacy && !rolesFor(next.isHq).includes(value.role) ? { role: "" } : {}) });
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
            <Choice key={r} on={value.role === r} onClick={() => set({ role: r })}>
              {r}
            </Choice>
          ))}
        </div>
        {legacy && (
          <div className="mt-2">
            <Choice on={value.role === legacy} onClick={() => set({ role: legacy })}>
              Keep “{legacy}”
            </Choice>
          </div>
        )}
      </Field>
    </>
  );
}
