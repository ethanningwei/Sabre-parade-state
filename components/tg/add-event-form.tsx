"use client";

import { useState } from "react";
import { addEventFor } from "@/lib/wb/actions/records";
import { emptyEvent, eventComplete, eventInput, EventQuestions, type EventAnswers } from "./apply/event-form";
import { BigButton, BigLink, DoneScreen, ErrorBox, Header, StepBar, Submit, useAction } from "./form-bits";
import { PeopleList, type PersonItem } from "./people-list";

// A commander records one event for several men at once (ports Sabre Bot's
// ADD): pick the people, then the same questions as the trooper's own Event
// form. No clash step: a commander entering twelve men has no useful answer to it.

const MAX = 40;

export function AddEventForm({ people, today }: { people: PersonItem[]; today: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"who" | "what">("who");
  const [a, setA] = useState<EventAnswers>(emptyEvent(today));
  const [done, setDone] = useState<number | null>(null);
  const { pending, error, setError, call } = useAction();

  if (done !== null) {
    return (
      <DoneScreen title={`Recorded for ${done}`} line="Everyone with Sabre gets a message about it.">
        <BigLink href="/tg">Home</BigLink>
      </DoneScreen>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else if (next.size >= MAX) return setError(`At most ${MAX} at a time. Do the rest in another batch.`);
    else next.add(id);
    setError(null);
    setPicked(next);
  };
  const names = people.filter((p) => picked.has(p.personId)).map((p) => `${p.rank} ${p.name}`);

  return (
    <div className="flex flex-col gap-5">
      <Header title="Add for several men" hint="A course, brief, IPPT or duty they've been detailed for. Recorded, no approval." />
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
            call(() => addEventFor({ ...eventInput(a), personIds: [...picked] }), (r) => setDone(r.count));
          }}
        >
          <p className="rounded-xl bg-card px-3.5 py-2.5 text-sm">
            For {names.length}: {names.join(", ")}{" "}
            <button type="button" className="underline" onClick={() => setStep("who")}>
              Change
            </button>
          </p>
          <EventQuestions a={a} set={setA} today={today} />
          <Submit pending={pending} disabled={!eventComplete(a)}>
            Record for {picked.size}
          </Submit>
        </form>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
