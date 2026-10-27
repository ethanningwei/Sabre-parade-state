"use client";

import { Input } from "@/components/ui/input";
import { STATUSES } from "@/lib/wb/domain/roles";
import { MAX_STATUSES } from "@/lib/wb/domain/rules";
import { Choice, Field, fieldClass, inputClass } from "../form-bits";

// One status as written on the paper: temporary or permanent, which one, and
// its dates. The outcome form (what the doctor gave) and "Statuses you already
// have" (2026-10-27) ask it the same way.

export interface StatusAnswers {
  permanent: boolean | null;
  type: string;
  other: string;
  startDate: string;
  endDate: string;
}

export const blankStatus = (today: string): StatusAnswers => ({ permanent: null, type: "", other: "", startDate: today, endDate: today });

/** The first thing still to fill in on status i of `count`, or null. */
export function statusMissing(s: StatusAnswers, i: number, count: number): string | null {
  const which = count > 1 ? `Status ${i + 1}: ` : "Status: ";
  if (s.permanent === null) return `${which}pick Temporary or Permanent.`;
  if (!s.type) return `${which}pick which status.`;
  if (s.type === "OTHER" && !s.other.trim()) return `${which}write it as it is on the paper.`;
  if (!s.startDate) return `${which}give the date it starts.`;
  if (!s.permanent && !s.endDate) return `${which}give the date it ends.`;
  if (!s.permanent && s.endDate < s.startDate) return `${which}it can't end before it starts.`;
  return null;
}

/** What the actions take for one status. */
export const statusInput = (s: StatusAnswers) => ({
  permanent: !!s.permanent,
  type: s.type as (typeof STATUSES)[number] | "OTHER",
  other: s.other,
  startDate: s.startDate,
  endDate: s.permanent ? null : s.endDate,
});

/** "How many statuses did you get?" 1 to MAX_STATUSES, keeping what's filled in. */
export function StatusCount({ label, statuses, today, onChange }: { label: string; statuses: StatusAnswers[]; today: string; onChange: (s: StatusAnswers[]) => void }) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: MAX_STATUSES }, (_, i) => i + 1).map((n) => (
          <Choice key={n} on={statuses.length === n} onClick={() => onChange(Array.from({ length: n }, (_, i) => statuses[i] ?? blankStatus(today)))}>
            <span className="w-full text-center">{n}</span>
          </Choice>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">More than {MAX_STATUSES}? Record these, then the rest as a second entry.</p>
    </Field>
  );
}

/** Status i of `count`: temporary or permanent, which, as on the paper, and from/until. */
export function StatusCard({
  s,
  i,
  count,
  min,
  onChange,
}: {
  s: StatusAnswers;
  i: number;
  count: number;
  /** the earliest "From" offered, if any */
  min?: string;
  onChange: (patch: Partial<StatusAnswers>) => void;
}) {
  return (
    <div className="tg-reveal flex flex-col gap-4 rounded-2xl bg-card p-4">
      <p className="font-medium">
        Status {i + 1} of {count}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Choice on={s.permanent === false} onClick={() => onChange({ permanent: false })}>
          Temporary
        </Choice>
        <Choice on={s.permanent === true} onClick={() => onChange({ permanent: true })}>
          Permanent
        </Choice>
      </div>
      <Field label="Which status?">
        <div className="flex flex-col gap-2">
          {STATUSES.map((t) => (
            <Choice key={t} on={s.type === t} onClick={() => onChange({ type: t })}>
              {t}
            </Choice>
          ))}
          <Choice on={s.type === "OTHER"} onClick={() => onChange({ type: "OTHER" })}>
            Something else
          </Choice>
        </div>
      </Field>
      {s.type === "OTHER" && (
        <div className="tg-reveal">
          <Field label="As written on the paper" htmlFor={`st${i}`}>
            <Input id={`st${i}`} value={s.other} onChange={(e) => onChange({ other: e.target.value })} placeholder="e.g. EXCUSE LOWER LIMB" autoCapitalize="characters" className={fieldClass} maxLength={60} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input
            type="date"
            required
            className={inputClass}
            value={s.startDate}
            min={min}
            aria-label={`Status ${i + 1} from`}
            onChange={(e) => onChange({ startDate: e.target.value, endDate: e.target.value > s.endDate ? e.target.value : s.endDate })}
          />
        </Field>
        {s.permanent !== true && (
          <Field label="Until">
            <input type="date" required className={inputClass} value={s.endDate} min={s.startDate} aria-label={`Status ${i + 1} until`} onChange={(e) => onChange({ endDate: e.target.value })} />
          </Field>
        )}
      </div>
    </div>
  );
}
