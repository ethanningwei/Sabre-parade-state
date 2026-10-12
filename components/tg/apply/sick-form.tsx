"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reportSick, type Submitted } from "@/lib/wb/actions/records";
import { addDays } from "@/lib/wb/domain/timeline";
import { Choice, Done, ErrorBox, Field, Header, inputClass, Submit, useAction } from "../form-bits";

// Report sick (ports Sabre Bot's SICK): where, which day, the clinic for an
// RSO, and what's wrong. Nearly everyone reports sick for today, so that's the
// default. His PC or PS approves it before he goes.

export function SickForm({ today }: { today: string }) {
  const [where, setWhere] = useState<"RSI" | "RSO" | null>(null);
  const [date, setDate] = useState(today);
  const [clinic, setClinic] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [result, setResult] = useState<Submitted | null>(null);
  const { pending, error, call } = useAction();

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <Done title="Sent to your commanders" delivery={result.delivery} subunitName={result.subunitName} needsApproval />
        <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm font-medium">Go only after one of them approves it.</p>
      </div>
    );
  }

  const ready = where && date && symptoms.trim() && (where === "RSI" || clinic.trim());

  return (
    <div className="flex flex-col gap-5">
      <Header title="Report sick" hint="Your PC or PS approves it. Go only after they do." />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (where) call(() => reportSick({ where, date, clinic, symptoms }), setResult);
        }}
      >
        <Field label="Where are you reporting sick?">
          <div className="flex flex-col gap-2">
            <Choice on={where === "RSI"} onClick={() => setWhere("RSI")}>
              🏕️ In camp (RSI)
            </Choice>
            <Choice on={where === "RSO"} onClick={() => setWhere("RSO")}>
              🏥 Outside camp (RSO)
            </Choice>
          </div>
        </Field>

        {where && (
          <>
            <Field label={where === "RSI" ? "Which day?" : "Which day are you going?"}>
              <div className="grid grid-cols-2 gap-2">
                <Choice on={date === today} onClick={() => setDate(today)}>
                  Today
                </Choice>
                <Choice on={date === addDays(today, 1)} onClick={() => setDate(addDays(today, 1))}>
                  Tomorrow
                </Choice>
              </div>
              <input type="date" required className={inputClass} value={date} min={today} aria-label="Day" onChange={(e) => setDate(e.target.value)} />
            </Field>
            {where === "RSO" && (
              <Field label="Which clinic or hospital?" htmlFor="clinic">
                <Input id="clinic" value={clinic} onChange={(e) => setClinic(e.target.value)} placeholder="e.g. Raffles Medical, Bedok" className="h-11 text-base" maxLength={100} />
              </Field>
            )}
            <Field label="What's wrong?" hint="Your symptoms, briefly. Your PC and PS see this." htmlFor="symptoms">
              <Textarea id="symptoms" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Fever and sore throat since last night" className="min-h-20 text-base" maxLength={300} />
            </Field>
            <Submit pending={pending} disabled={!ready}>
              Send to my commanders
            </Submit>
          </>
        )}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}
