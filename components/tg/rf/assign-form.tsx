"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { assignMen } from "@/lib/wb/actions/rf";
import { ASSIGNMENT_LABEL, MAX_ASSIGN, WB_ASSIGNMENT_TYPES, type WbAssignmentType } from "@/lib/wb/domain/rf";
import { BigButton, BigLink, Choice, DoneScreen, ErrorBox, Field, Header, hhmm, inputClass, StepBar, Submit, useAction } from "../form-bits";
import { PeopleList, type PersonItem } from "../people-list";
import { fieldClass } from "../ui";

// Extra, RF or SOL straight onto men (Sabre Bot's /assign): who, then what,
// where and when. A commander entering it is the approval; each man is told.

export interface AssignCamp {
  id: string;
  name: string;
  subunitName: string;
}

const HINT: Record<WbAssignmentType, string> = {
  EXTRA: "Serving extra at another camp: absent from his own, counted there.",
  RF: "Sent to another camp without a request: absent from his own, counted there.",
  SOL: "Leave stopped: he stands with his own camp, and with its other team while his is off.",
};

export function AssignForm({ people, camps, today }: { people: PersonItem[]; camps: AssignCamp[]; today: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"who" | "what">("who");
  const [type, setType] = useState<WbAssignmentType | null>(null);
  const [campId, setCampId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const { pending, error, setError, call } = useAction();

  if (done !== null) {
    return (
      <DoneScreen title={`${ASSIGNMENT_LABEL[type!]} for ${done}`} line="Each man with Sabre has been told, and so have their platoons' commanders.">
        <BigLink href="/tg/assign">Assign more</BigLink>
        <BigLink href="/tg" outline>
          Home
        </BigLink>
      </DoneScreen>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else if (next.size >= MAX_ASSIGN) return setError(`At most ${MAX_ASSIGN} at a time.`);
    else next.add(id);
    setError(null);
    setPicked(next);
  };
  const names = people.filter((p) => picked.has(p.personId)).map((p) => `${p.rank} ${p.name}`);
  const complete = !!(type && (type === "SOL" || campId) && startDate && endDate && startTime && endTime);

  return (
    <div className="flex flex-col gap-5">
      <Header title="Assign Extra, RF or SOL" hint="For men you've been told to send. To ask the company for men, use Ask for manpower instead." />
      <StepBar at={step === "who" ? 1 : 2} of={2} label={step === "who" ? "Who" : "What"} onBack={step === "what" ? () => setStep("who") : undefined} />
      {step === "who" ? (
        <>
          <PeopleList people={people} picked={picked} onToggle={toggle} />
          <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-2xl border bg-card/95 p-3 shadow-lg shadow-black/5 backdrop-blur">
            <p className="text-sm">{picked.size ? `${picked.size} picked` : "Pick who it's for."}</p>
            <BigButton onClick={() => setStep("what")} disabled={!picked.size}>
              Next
            </BigButton>
          </div>
        </>
      ) : (
        <form
          className="tg-reveal flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            call(
              () => assignMen({ type: type!, campId: type === "SOL" ? null : campId, personIds: [...picked], startDate, startTime: hhmm(startTime), endDate, endTime: hhmm(endTime), note }),
              (r) => setDone(r.count),
            );
          }}
        >
          <div className="flex items-center gap-2 rounded-xl bg-card py-1 pr-1 pl-3.5 text-sm">
            <p className="flex-1 py-1.5">
              For {names.length}: {names.join(", ")}
            </p>
            <button type="button" className="tg-press min-h-11 shrink-0 rounded-lg px-3 font-medium text-primary active:bg-muted" onClick={() => setStep("who")}>
              Change
            </button>
          </div>
          <Field label="What?" hint={type ? HINT[type] : undefined}>
            <div className="grid grid-cols-3 gap-2">
              {WB_ASSIGNMENT_TYPES.map((t) => (
                <Choice key={t} on={type === t} onClick={() => setType(t)}>
                  {ASSIGNMENT_LABEL[t]}
                </Choice>
              ))}
            </div>
          </Field>
          {type && type !== "SOL" && (
            <Field label="At which camp?">
              <div className="grid grid-cols-2 gap-2">
                {camps.map((c) => (
                  <Choice key={c.id} on={campId === c.id} onClick={() => setCampId(c.id)}>
                    {c.name}
                  </Choice>
                ))}
              </div>
            </Field>
          )}
          {type && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="From">
                  <input type="date" required className={inputClass} value={startDate} min={today} aria-label="From" onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }} />
                </Field>
                <Field label="At">
                  <input type="time" required className={inputClass} value={startTime} aria-label="From time" onChange={(e) => setStartTime(e.target.value)} />
                </Field>
                <Field label="Until">
                  <input type="date" required className={inputClass} value={endDate} min={startDate} aria-label="Until" onChange={(e) => setEndDate(e.target.value)} />
                </Field>
                <Field label="At">
                  <input type="time" required className={inputClass} value={endTime} aria-label="Until time" onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">0000 to 2359 is the whole day.</p>
              <Field label="Note (optional)" htmlFor="note">
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. OC's order" className={fieldClass} maxLength={200} />
              </Field>
            </>
          )}
          <Submit pending={pending} disabled={!complete}>
            {type ? `${ASSIGNMENT_LABEL[type]} for ${picked.size}` : "Pick what it is"}
          </Submit>
        </form>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
