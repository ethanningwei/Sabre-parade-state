"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { reportMa, type Submitted } from "@/lib/wb/actions/records";
import { BigButton, Done, ErrorBox, Field, Header, hhmm, inputClass, Submit, useAction } from "../form-bits";
import { fieldClass } from "../ui";

// A medical appointment (ports Sabre Bot's MA). Physio is weekly and the
// answers never change, so someone who's been before is offered last time's
// time and place first: a repeat booking is one question, not three.
// What the doctor gives him is recorded afterwards, from My records.

export function MaForm({ today, last }: { today: string; last: { maTiming: string; location: string } | null }) {
  const [again, setAgain] = useState<boolean | null>(last ? null : false);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [place, setPlace] = useState("");
  const [result, setResult] = useState<Submitted | null>(null);
  const { pending, error, call } = useAction();

  if (result) {
    return (
      <Done
        title="Appointment recorded"
        delivery={result.delivery}
        subunitName={result.subunitName}
        needsApproval={false}
        note="If the doctor gives you an MC or status, open My records and tap Update outcome."
      />
    );
  }

  const submit = () =>
    call(
      () => reportMa({ date, time: again && last ? last.maTiming : hhmm(time), place: again && last ? last.location : place }),
      setResult,
    );

  return (
    <div className="flex flex-col gap-5">
      <Header title="Medical appointment" hint="You're down as away for that day." />

      {again === null && last && (
        <section className="tg-reveal flex flex-col gap-3">
          <p className="px-1 font-medium">Same as last time?</p>
          <p className="rounded-xl bg-card px-3 py-2">
            {last.maTiming}H @ {last.location}
          </p>
          <BigButton onClick={() => setAgain(true)}>Yes, same time and place</BigButton>
          <BigButton variant="outline" onClick={() => setAgain(false)}>
            No, this one is different
          </BigButton>
        </section>
      )}

      {again !== null && (
        <form
          className="tg-reveal flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Which day?">
            <input type="date" required className={inputClass} value={date} min={today} aria-label="Day" onChange={(e) => setDate(e.target.value)} />
          </Field>
          {again ? (
            <p className="text-sm text-muted-foreground">
              {last!.maTiming}H @ {last!.location}
            </p>
          ) : (
            <>
              <Field label="What time?">
                <input type="time" required className={inputClass} value={time} aria-label="Time" onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label="Where?" htmlFor="place">
                <Input id="place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. National Skin Centre" className={fieldClass} maxLength={100} />
              </Field>
            </>
          )}
          <Submit pending={pending} disabled={!date || (!again && (!time || !place.trim()))}>
            Record it
          </Submit>
        </form>
      )}

      <ErrorBox error={error} />
    </div>
  );
}
