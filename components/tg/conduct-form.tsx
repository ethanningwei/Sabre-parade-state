"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setUpConduct } from "@/lib/wb/actions/conducts";
import { DEFAULT_TITLE } from "@/lib/wb/domain/strength-list";
import { ErrorBox, Field, fieldClass, hhmm, inputClass, Submit, useAction } from "./form-bits";
import { Group } from "./ui";
import { tick } from "./webapp";

// Set up a conduct (slice 2 of docs/conducts-plan.md): its name, the day, when
// the strengths are due, and which camps. The camps off shift that day start
// ticked: they're the ones that go.

type Camp = { id: string; name: string; subunitName: string };

const dayLabel = (date: string, i: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = `${d.toLocaleDateString("en-SG", { weekday: "short", timeZone: "UTC" })} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return i === 0 ? `Today, ${day}` : i === 1 ? `Tomorrow, ${day}` : day;
};

export function ConductForm({ days, camps, ticked }: { days: string[]; camps: Camp[]; ticked: Record<string, string[]> }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [date, setDate] = useState(days[0]);
  const [time, setTime] = useState("18:30");
  const [picked, setPicked] = useState<string[]>(ticked[days[0]] ?? []);
  const platoons = [...new Set(camps.map((c) => c.subunitName))];

  const toggle = (id: string) => {
    tick();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        call(
          () => setUpConduct({ title, date, reportBy: hhmm(time), campIds: picked }),
          (r) => router.push(`/tg/conducts/${r.id}`),
        );
      }}
    >
      <Field label="Conduct" htmlFor="conduct-title" hint="The first line of every camp's message.">
        <input id="conduct-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoCapitalize="characters" required />
      </Field>
      <Field label="Day" htmlFor="conduct-day">
        <select
          id="conduct-day"
          className={`${fieldClass} w-full`}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPicked(ticked[e.target.value] ?? []);
          }}
        >
          {days.map((d, i) => (
            <option key={d} value={d}>
              {dayLabel(d, i)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Strengths due by" htmlFor="conduct-time" hint="The GCs see it in their DM. Nothing is sent at that time by itself: nudge anyone late.">
        <input id="conduct-time" type="time" className={`${fieldClass} w-full`} value={time} onChange={(e) => setTime(e.target.value)} required />
      </Field>
      <p className="-mb-2 px-1 text-sm text-muted-foreground">Camps off shift that day are ticked. Each camp&apos;s GC gets a DM to send its strength.</p>
      {platoons.map((p) => (
        <Group key={p} title={p} rows>
          {camps
            .filter((c) => c.subunitName === p)
            .map((c) => {
              const on = picked.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(c.id)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-muted"
                >
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {on && <Check className="size-4" aria-hidden />}
                  </span>
                  <span className="flex-1 font-medium">{c.name}</span>
                </button>
              );
            })}
        </Group>
      ))}
      <ErrorBox error={error} />
      <Submit pending={pending} missing={picked.length ? null : "Tick at least one camp."}>
        Set up and tell the GCs
      </Submit>
    </form>
  );
}
