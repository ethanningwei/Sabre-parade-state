"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findMe, register, type FoundPerson, type RegisterInput } from "@/lib/wb/actions/register";
import { TAKEN_MESSAGE } from "@/lib/wb/domain/registration";
import { place } from "@/lib/wb/format";
import { RANKS, rolesFor } from "@/lib/wb/domain/roles";
import type { SubunitWithCamps } from "@/lib/wb/roster";
import { webApp } from "./webapp";
import { bigButtonClass, fieldClass, inputClass } from "./ui";

type Details = RegisterInput["details"];
type Step =
  | { at: "name" }
  | { at: "nomatch"; typed: string }
  | { at: "confirm"; person: FoundPerson }
  | { at: "pick"; people: FoundPerson[] }
  | { at: "self"; typed: string }
  | { at: "details"; personId?: string; self?: NonNullable<RegisterInput["self"]>; who: string };

const selectClass = inputClass;

const describe = (p: FoundPerson) => `${p.rank} ${p.name}`;
const where = (p: FoundPerson) => place(p.campName, p.subunitName, p.role);

export function RegisterFlow({ structure, initial }: { structure: SubunitWithCamps[]; initial: Details }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ at: "name" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);
  // on a phone the message is often below the fold, under the keyboard
  useEffect(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), [error]);

  const fail = (msg: string) => {
    setError(msg);
    webApp()?.HapticFeedback?.notificationOccurred("error");
  };
  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const search = () =>
    start(async () => {
      const res = await findMe(name);
      if (!res.ok) return fail(res.error);
      const r = res.data;
      if (r.kind === "too-many") return fail(`That matches ${r.count} people. Type more of your name.`);
      if (r.kind === "none") return go({ at: "nomatch", typed: name.trim() });
      if (r.kind === "one") return go({ at: "confirm", person: r.person });
      go({ at: "pick", people: r.people });
    });

  const choose = (p: FoundPerson) => {
    if (p.taken) return fail(TAKEN_MESSAGE);
    go({ at: "details", personId: p.personId, who: `${describe(p)} · ${where(p)}` });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Register</h1>
        <p className="text-sm text-muted-foreground">
          Sabre takes your report sick, MA, leave and off, and puts them in front of your commanders.
        </p>
      </header>

      {step.at === "name" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Label htmlFor="name">Who are you?</Label>
          <Input
            id="name"
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name on the parade state"
            className={fieldClass}
          />
          <Button type="submit" size="lg" className={bigButtonClass} disabled={pending || name.trim().length < 2}>
            {pending && <Loader2 className="animate-spin" />}
            Find me
          </Button>
        </form>
      )}

      {step.at === "nomatch" && (
        <section className="flex flex-col gap-3">
          <p className="font-medium">I can&apos;t find “{step.typed}”</p>
          <p className="text-sm text-muted-foreground">
            Almost everybody is on the parade state, so check the spelling first. Ask your GC or PS if you&apos;re unsure
            of your parade-state name. If you really aren&apos;t on it, I can set you up and your PS will see you on Roster.
          </p>
          <Button size="lg" className={bigButtonClass} onClick={() => go({ at: "name" })}>
            Try my name again
          </Button>
          <Button size="lg" variant="outline" className={bigButtonClass} onClick={() => go({ at: "self", typed: step.typed })}>
            I&apos;m not on it — set me up
          </Button>
        </section>
      )}

      {step.at === "confirm" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Found you:</p>
          <div className="rounded-2xl bg-card p-4">
            <p className="font-medium">{describe(step.person)}</p>
            <p className="text-sm text-muted-foreground">{where(step.person)}</p>
          </div>
          <p>Is this you?</p>
          <Button size="lg" className={bigButtonClass} onClick={() => choose(step.person)}>
            Yes, that&apos;s me
          </Button>
          <Button size="lg" variant="outline" className={bigButtonClass} onClick={() => go({ at: "name" })}>
            Not me
          </Button>
        </section>
      )}

      {step.at === "pick" && (
        <section className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Which one is you?</p>
          {step.people.map((p) => (
            <button
              key={p.personId}
              type="button"
              onClick={() => choose(p)}
              className="flex min-h-14 flex-col items-start justify-center rounded-2xl bg-card px-4 py-2 text-left active:bg-muted"
            >
              <span className="font-medium">{describe(p)}</span>
              <span className="text-xs text-muted-foreground">{where(p)}</span>
            </button>
          ))}
          <Button size="lg" variant="outline" className={bigButtonClass} onClick={() => go({ at: "name" })}>
            None of these
          </Button>
        </section>
      )}

      {step.at === "self" && <SelfForm typed={step.typed} structure={structure} onDone={(self, who) => go({ at: "details", self, who })} />}

      {step.at === "details" && (
        <DetailsForm
          who={step.who}
          initial={initial}
          pending={pending}
          onBack={() => go({ at: "name" })}
          onSubmit={(details) =>
            start(async () => {
              const res = await register({ personId: step.personId, self: step.self, details });
              if (!res.ok) return fail(res.error);
              webApp()?.HapticFeedback?.notificationOccurred("success");
              router.replace("/tg");
              router.refresh();
            })
          }
        />
      )}

      {error && (
        <p ref={errorRef} role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SelfForm({
  typed,
  structure,
  onDone,
}: {
  typed: string;
  structure: SubunitWithCamps[];
  onDone: (self: NonNullable<RegisterInput["self"]>, who: string) => void;
}) {
  const [name, setName] = useState(typed.toUpperCase());
  const [subunitId, setSubunitId] = useState("");
  const [campId, setCampId] = useState("");
  const [role, setRole] = useState("");
  const [rank, setRank] = useState("");
  const sub = structure.find((s) => s.id === subunitId);
  const roles = sub ? rolesFor(sub.isHq) : [];
  const complete = name.trim().length >= 2 && campId && role && rank;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete || !sub) return;
        const campName = sub.camps.find((c) => c.id === campId)?.name ?? "";
        onDone(
          { name, campId, role, rank: rank as (typeof RANKS)[number] },
          `${rank} ${name.toUpperCase()} · ${place(campName, sub.name, role)}`,
        );
      }}
    >
      <Field label="Your name, as on the parade state">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="characters" className={fieldClass} />
      </Field>
      <Field label="Which platoon?">
        <select
          className={selectClass}
          value={subunitId}
          onChange={(e) => {
            setSubunitId(e.target.value);
            setCampId("");
            setRole("");
          }}
        >
          <option value="">Pick one</option>
          {structure.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {sub && (
        <>
          <Field label="Which camp?">
            <select className={selectClass} value={campId} onChange={(e) => setCampId(e.target.value)}>
              <option value="">Pick one</option>
              {sub.camps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your role?">
            <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Pick one</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="Your rank?">
        <select className={selectClass} value={rank} onChange={(e) => setRank(e.target.value)}>
          <option value="">Pick one</option>
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" size="lg" className={bigButtonClass} disabled={!complete}>
        Next
      </Button>
    </form>
  );
}

function DetailsForm({
  who,
  initial,
  pending,
  onBack,
  onSubmit,
}: {
  who: string;
  initial: Details;
  pending: boolean;
  onBack: () => void;
  onSubmit: (d: Details) => void;
}) {
  const [d, setD] = useState<Details>(initial);
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(d);
      }}
    >
      <div className="rounded-2xl bg-card p-3 text-sm">{who}</div>
      <Field label="Full name, as on your NRIC">
        <Input value={d.fullName} onChange={set("fullName")} autoCapitalize="characters" className={fieldClass} />
      </Field>
      <Field label="Last 4 of your NRIC" hint="3 digits and a letter, e.g. 567A. Only the last 4, never the whole number.">
        <Input value={d.nric} onChange={set("nric")} autoCapitalize="characters" maxLength={9} className={`${fieldClass} font-mono`} />
      </Field>
      <Field label="ORD date (DDMMYY)">
        <Input value={d.ord} onChange={set("ord")} inputMode="numeric" placeholder="270828" className={`${fieldClass} font-mono`} />
      </Field>
      <Field label="Days of leave left" hint="Your PS can correct this later.">
        <Input value={d.leaveLeft} onChange={set("leaveLeft")} inputMode="numeric" className={fieldClass} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Are you stay-out?</legend>
        {(
          [
            ["NONE", "No"],
            ["PERM", "Yes, permanently"],
            ["TEMP", "Yes, until a date"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex min-h-12 items-center gap-3 rounded-xl bg-card px-3.5">
            <input type="radio" name="stayout" checked={d.stayout === v} onChange={() => setD({ ...d, stayout: v })} className="size-4" />
            {label}
          </label>
        ))}
      </fieldset>
      {d.stayout === "TEMP" && (
        <Field label="Stay-out until (DDMMYY)">
          <Input value={d.stayoutUntil ?? ""} onChange={set("stayoutUntil")} inputMode="numeric" className={`${fieldClass} font-mono`} />
        </Field>
      )}
      <Button type="submit" size="lg" className={bigButtonClass} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save
      </Button>
      <Button type="button" variant="ghost" className={bigButtonClass} onClick={onBack}>
        Start again
      </Button>
    </form>
  );
}

/** A labelled control: the <label> wraps it, so tapping the label focuses it. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
