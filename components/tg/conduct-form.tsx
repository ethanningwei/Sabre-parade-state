"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setUpConduct } from "@/lib/wb/actions/conducts";
import { NAMED_TITLE, type Team } from "@/lib/wb/domain/named-list";
import { DEFAULT_TITLE } from "@/lib/wb/domain/strength-list";
import { Choice, ErrorBox, Field, fieldClass, hhmm, inputClass, Submit, useAction } from "./form-bits";
import { Group } from "./ui";
import { tick } from "./webapp";

// Set up a conduct (slices 2 and 3 of docs/conducts-plan.md): a strength (CPT,
// whole camps) or a named list (OSE, comd training, IPPT: each GC names who's
// going). Its name, the day, when it's due, and which camps. A strength starts
// with the camps off shift that day ticked; a named list with every camp that
// has no partner team, and of each pair the team that's off, its letter as the
// Team line.

type Camp = { id: string; name: string; subunitName: string };
type Kind = "STRENGTH" | "NAMED";

const dayLabel = (date: string, i: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = `${d.toLocaleDateString("en-SG", { weekday: "short", timeZone: "UTC" })} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return i === 0 ? `Today, ${day}` : i === 1 ? `Tomorrow, ${day}` : day;
};

/** The day before, or the day itself when that's today. */
const dueDefault = (days: string[], date: string) => days[Math.max(0, days.indexOf(date) - 1)];

export function ConductForm({
  days,
  camps,
  ticked,
  named,
}: {
  days: string[];
  camps: Camp[];
  ticked: Record<string, string[]>;
  named: Record<string, { ticked: string[]; team: Team | null }>;
}) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const [kind, setKind] = useState<Kind>("STRENGTH");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [date, setDate] = useState(days[0]);
  const [team, setTeam] = useState<Team | null>(null);
  const [dueDate, setDueDate] = useState(days[0]);
  const [time, setTime] = useState("18:30");
  const [picked, setPicked] = useState<string[]>(ticked[days[0]] ?? []);
  const platoons = [...new Set(camps.map((c) => c.subunitName))];
  const isNamed = kind === "NAMED";

  // a new kind or day starts from that day's ticks (and team)
  const reset = (k: Kind, d: string) => {
    setPicked(k === "NAMED" ? (named[d]?.ticked ?? []) : (ticked[d] ?? []));
    setTeam(k === "NAMED" ? (named[d]?.team ?? null) : null);
    setDueDate(k === "NAMED" ? dueDefault(days, d) : d);
  };

  const pickKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    if (title === (k === "NAMED" ? DEFAULT_TITLE : NAMED_TITLE)) setTitle(k === "NAMED" ? NAMED_TITLE : DEFAULT_TITLE);
    setTime(k === "NAMED" ? "18:00" : "18:30");
    reset(k, date);
  };

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
          () => setUpConduct({ kind, title, date, reportBy: hhmm(time), campIds: picked, team: isNamed ? team : null, dueDate: isNamed ? dueDate : null }),
          (r) => router.push(`/tg/conducts/${r.id}`),
        );
      }}
    >
      <Field label="What for">
        <div className="grid grid-cols-2 gap-2">
          <Choice on={!isNamed} onClick={() => pickKind("STRENGTH")}>
            <span className="flex flex-col">
              <span>Strength</span>
              <span className="text-xs font-normal text-muted-foreground">CPT: whole camps</span>
            </span>
          </Choice>
          <Choice on={isNamed} onClick={() => pickKind("NAMED")}>
            <span className="flex flex-col">
              <span>Named list</span>
              <span className="text-xs font-normal text-muted-foreground">OSE, comd trg, IPPT</span>
            </span>
          </Choice>
        </div>
      </Field>
      <Field label="Conduct" htmlFor="conduct-title" hint={isNamed ? "The coy list's first line. Type IPPT for an IPPT list." : "The first line of every camp's message."}>
        <input id="conduct-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoCapitalize="characters" required />
      </Field>
      <Field label="Day" htmlFor="conduct-day">
        <select
          id="conduct-day"
          className={`${fieldClass} w-full`}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            reset(kind, e.target.value);
          }}
        >
          {days.map((d, i) => (
            <option key={d} value={d}>
              {dayLabel(d, i)}
            </option>
          ))}
        </select>
      </Field>
      {isNamed && (
        <Field label="Team" hint="The (Team A) line under the title.">
          <div className="grid grid-cols-3 gap-2">
            {(["A", "B", null] as const).map((t) => (
              <Choice key={t ?? "none"} on={team === t} onClick={() => setTeam(t)}>
                {t ?? "None"}
              </Choice>
            ))}
          </div>
        </Field>
      )}
      {isNamed && (
        <Field label="Names due on" htmlFor="conduct-due-day">
          <select id="conduct-due-day" className={`${fieldClass} w-full`} value={dueDate} onChange={(e) => setDueDate(e.target.value)}>
            {days
              .filter((d) => d <= date)
              .map((d, i) => (
                <option key={d} value={d}>
                  {dayLabel(d, i)}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field
        label={isNamed ? "Names due by" : "Strengths due by"}
        htmlFor="conduct-time"
        hint={isNamed ? "The GCs see it in their DM. They can still change their names until the day." : "The GCs see it in their DM. Nothing is sent at that time by itself: nudge anyone late."}
      >
        <input id="conduct-time" type="time" className={`${fieldClass} w-full`} value={time} onChange={(e) => setTime(e.target.value)} required />
      </Field>
      <p className="-mb-2 px-1 text-sm text-muted-foreground">
        {isNamed
          ? "Every camp is ticked, and of SFT, SRF, OSU and PYAD the team off that day. The empty list goes into Commanders of N23 now; each camp's GC gets a DM to name his men."
          : "Camps off shift that day are ticked. Each camp's GC gets a DM to send its strength."}
      </p>
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
        {isNamed ? "Set up, post the list and tell the GCs" : "Set up and tell the GCs"}
      </Submit>
    </form>
  );
}
