"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { addEventFor } from "@/lib/wb/actions/records";
import { emptyEvent, eventComplete, eventInput, EventQuestions, type EventAnswers } from "./apply/event-form";
import { BigButton, ErrorBox, Header, Submit, useAction } from "./form-bits";
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
      <section className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-12 text-emerald-600" />
        <h2 className="text-xl font-semibold">Recorded for {done}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Everyone with Sabre gets a message about it.</p>
        <Link href="/tg" className={buttonVariants({ size: "lg", className: "h-11 w-full" })}>
          Home
        </Link>
      </section>
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
      {step === "who" ? (
        <>
          <PeopleList people={people} picked={picked} onToggle={toggle} />
          <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
            <p className="text-sm">{picked.size ? `${picked.size} picked` : "Pick who it's for."}</p>
            <BigButton onClick={() => setStep("what")} disabled={!picked.size}>
              Next
            </BigButton>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            call(() => addEventFor({ ...eventInput(a), personIds: [...picked] }), (r) => setDone(r.count));
          }}
        >
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
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
