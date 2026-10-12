"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { checkClash, reportEvent, type Submitted } from "@/lib/wb/actions/records";
import { ClashStep, Done, ErrorBox, Field, Header, hhmm, inputClass, Submit, useAction } from "../form-bits";
import { fieldClass } from "../ui";

// A course, brief, IPPT or anything else (ports Sabre Bot's _event_questions).
// The trooper's own form and a commander's "Add for several men" ask the same
// questions in the same words, so the same course reads the same either way.

export interface EventAnswers {
  what: string;
  place: string;
  startDate: string;
  endDate: string;
  timeStart: string;
  timeEnd: string;
}

export const emptyEvent = (today: string): EventAnswers => ({ what: "", place: "", startDate: today, endDate: today, timeStart: "00:00", timeEnd: "23:59" });

export const eventInput = (a: EventAnswers) => ({ ...a, timeStart: hhmm(a.timeStart), timeEnd: hhmm(a.timeEnd) });

/** What, where, from, until, and the daily hours (default whole day). */
export function EventQuestions({ a, set, today }: { a: EventAnswers; set: (a: EventAnswers) => void; today: string }) {
  const oneDay = a.startDate === a.endDate;
  return (
    <>
      <Field label="What is it?" htmlFor="what">
        <Input id="what" value={a.what} onChange={(e) => set({ ...a, what: e.target.value })} placeholder="e.g. DV DRIVER COURSE, IPPT" autoCapitalize="characters" className={fieldClass} maxLength={100} />
      </Field>
      <Field label="Where is it?" htmlFor="where">
        <Input id="where" value={a.place} onChange={(e) => set({ ...a, place: e.target.value })} placeholder="e.g. MAJU CAMP, or IN CAMP" autoCapitalize="characters" className={fieldClass} maxLength={100} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input type="date" required className={inputClass} value={a.startDate} min={today} aria-label="From" onChange={(e) => set({ ...a, startDate: e.target.value, endDate: e.target.value > a.endDate ? e.target.value : a.endDate })} />
        </Field>
        <Field label="Until">
          <input type="date" required className={inputClass} value={a.endDate} min={a.startDate} aria-label="Until" onChange={(e) => set({ ...a, endDate: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={oneDay ? "Starts at" : "Starts each day at"}>
          <input type="time" required className={inputClass} value={a.timeStart} aria-label="Start time" onChange={(e) => set({ ...a, timeStart: e.target.value })} />
        </Field>
        <Field label={oneDay ? "Ends at" : "Ends each day at"}>
          <input type="time" required className={inputClass} value={a.timeEnd} aria-label="End time" onChange={(e) => set({ ...a, timeEnd: e.target.value })} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">0000 to 2359 means the whole day.</p>
    </>
  );
}

export const eventComplete = (a: EventAnswers) => !!(a.what.trim() && a.place.trim() && a.startDate && a.endDate && a.timeStart && a.timeEnd);

export function EventForm({ today }: { today: string }) {
  const [a, setA] = useState<EventAnswers>(emptyEvent(today));
  const [clash, setClash] = useState<string[] | null>(null);
  const [result, setResult] = useState<Submitted | null>(null);
  const { pending, error, call } = useAction();

  if (result) return <Done title="Recorded" delivery={result.delivery} subunitName={result.subunitName} needsApproval={false} />;

  const save = () => call(() => reportEvent(eventInput(a)), setResult);
  const next = () =>
    call(
      () => checkClash({ startDate: a.startDate, startTime: "0000", endDate: a.endDate, endTime: "2359" }),
      (lines) => (lines.length ? setClash(lines) : save()),
    );

  return (
    <div className="flex flex-col gap-5">
      <Header title="Course, brief, IPPT, anything else" />
      {clash ? (
        <ClashStep lines={clash} onCarryOn={save} onChange={() => setClash(null)} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <EventQuestions a={a} set={setA} today={today} />
          <Submit pending={pending} disabled={!eventComplete(a)}>
            Record it
          </Submit>
        </form>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
