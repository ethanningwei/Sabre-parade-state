"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { saveShiftPattern } from "@/lib/wb/actions/shifts";
import { parseMinimum, WEEKDAY_NAMES, type WbShiftKind } from "@/lib/wb/domain/shifts";
import { Choice, ErrorBox, Field, hhmm, inputClass, Step, Submit, useAction } from "../form-bits";

export interface ShiftFormInitial {
  kind: WbShiftKind;
  onDays: number;
  offDays: number;
  anchorCampId: string;
  anchorDate: string;
  hotoTime: string;
  weekdayMask: number;
  holidaysOff: boolean;
  bothOnAllowed: boolean;
  minimums: Record<string, string>;
}

const KINDS: { kind: WbShiftKind; label: string; hint: string }[] = [
  { kind: "CYCLE", label: "Takes turns", hint: "Days on, then days off, e.g. 3 in 3 out" },
  { kind: "WEEKLY", label: "Set weekdays", hint: "RG: Monday to Friday" },
  { kind: "ALWAYS", label: "Always on", hint: "Every day" },
];

const asTime = (t: string) => `${t.slice(0, 2)}:${t.slice(2, 4)}`;

/** A camp's pattern and its teams' minimums. A pair is set together: the other team follows. */
export function ShiftForm({ teams, isHq, initial }: { teams: { id: string; name: string }[]; isHq: boolean; initial: ShiftFormInitial }) {
  const router = useRouter();
  const { pending, error, setError, call } = useAction();
  const pair = teams.length === 2;
  const [kind, setKind] = useState<WbShiftKind>(initial.kind);
  const [onDays, setOnDays] = useState(String(initial.onDays));
  const [offDays, setOffDays] = useState(String(initial.offDays));
  const [anchorCampId, setAnchorCampId] = useState(initial.anchorCampId);
  const [anchorDate, setAnchorDate] = useState(initial.anchorDate);
  const [time, setTime] = useState(asTime(initial.hotoTime));
  const [mask, setMask] = useState(initial.weekdayMask);
  const [holidaysOff, setHolidaysOff] = useState(initial.holidaysOff);
  const [bothOn, setBothOn] = useState(initial.bothOnAllowed);
  const [mins, setMins] = useState(initial.minimums);

  const n = (s: string) => Number.parseInt(s, 10);
  const lead = teams.find((t) => t.id === anchorCampId)?.name ?? teams[0].name;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const t of teams) {
      const raw = (mins[t.id] ?? "").trim();
      if (raw && !parseMinimum(raw)) return setError(`${t.name}'s minimum should look like 1:4:3 (GC:ST CBT:ST SVC), or a number.`);
    }
    call(
      () =>
        saveShiftPattern({
          campIds: teams.map((t) => t.id),
          kind,
          onDays: kind === "CYCLE" ? n(onDays) || 0 : 1,
          offDays: kind === "CYCLE" ? (pair ? n(onDays) || 0 : n(offDays) || 0) : 0,
          anchorCampId: kind === "CYCLE" ? anchorCampId : null,
          anchorDate: kind === "CYCLE" ? anchorDate : null,
          hotoTime: hhmm(time),
          weekdayMask: mask,
          holidaysOff,
          bothOnAllowed: pair && bothOn,
          minimums: mins,
        }),
      () => {
        toast.success("Saved");
        router.push("/tg/shifts");
        router.refresh();
      },
    );
  }

  let step = 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Step n={++step} title="How does it run?">
        <div className="flex flex-col gap-2">
          {KINDS.map((k) => (
            <Choice key={k.kind} on={kind === k.kind} onClick={() => setKind(k.kind)}>
              <span className="flex flex-col">
                <span>{k.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{k.hint}</span>
              </span>
            </Choice>
          ))}
        </div>
      </Step>

      {kind === "CYCLE" && (
        <Step n={++step} title="The cycle" hint={pair ? "One team is on while the other is off, so a pair's days on and off are the same." : undefined}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days on" htmlFor="on-days">
              <input id="on-days" inputMode="numeric" className={inputClass} value={onDays} onChange={(e) => setOnDays(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Days off" htmlFor="off-days">
              <input id="off-days" inputMode="numeric" className={inputClass} value={pair ? onDays : offDays} disabled={pair} onChange={(e) => setOffDays(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          {pair && (
            <Field label="Which team took over last?">
              <div className="grid grid-cols-2 gap-2">
                {teams.map((t) => (
                  <Choice key={t.id} on={anchorCampId === t.id} onClick={() => setAnchorCampId(t.id)}>
                    {t.name}
                  </Choice>
                ))}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={pair ? `${lead} took over on` : "A stint started on"} htmlFor="anchor-date">
              <input id="anchor-date" type="date" required className={inputClass} value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
            </Field>
            <Field label="HOTO at" htmlFor="hoto-time">
              <input id="hoto-time" type="time" required className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          {pair && (
            <Choice on={bothOn} onClick={() => setBothOn(!bothOn)}>
              <span className="flex flex-col">
                <span>Both teams may stand at once</span>
                <span className="text-xs font-normal text-muted-foreground">SRF: a HOTO can put both on</span>
              </span>
            </Choice>
          )}
        </Step>
      )}

      {kind === "WEEKLY" && (
        <Step n={++step} title="Which days">
          <div className="grid grid-cols-4 gap-2">
            {WEEKDAY_NAMES.map((d, i) => (
              <Choice key={d} on={!!(mask & (1 << i))} onClick={() => setMask(mask ^ (1 << i))}>
                {d}
              </Choice>
            ))}
          </div>
          <Choice on={holidaysOff} onClick={() => setHolidaysOff(!holidaysOff)}>
            Public holidays are off
          </Choice>
        </Step>
      )}

      {!isHq && (
        <Step n={++step} title="Minimum manning" hint="GC:ST CBT:ST SVC, e.g. 1:4:3. A single number is a total with no split. Leave it empty if there's no minimum.">
          {teams.map((t) => (
            <Field key={t.id} label={t.name} htmlFor={`min-${t.id}`}>
              <input
                id={`min-${t.id}`}
                inputMode="text"
                autoCapitalize="off"
                placeholder="1:4:3"
                className={inputClass}
                value={mins[t.id] ?? ""}
                onChange={(e) => setMins({ ...mins, [t.id]: e.target.value })}
              />
            </Field>
          ))}
        </Step>
      )}

      <ErrorBox error={error} />
      <Submit pending={pending}>Save</Submit>
    </form>
  );
}
