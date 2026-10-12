"use client";

import { Hospital, Tent } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reportSick, type Submitted } from "@/lib/wb/actions/records";
import { addDays } from "@/lib/wb/domain/timeline";
import { Choice, Done, ErrorBox, Field, fieldClass, Header, inputClass, Step, Submit, textareaClass, useAction } from "../form-bits";

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
    return <Done title="Sent to your commanders" delivery={result.delivery} subunitName={result.subunitName} needsApproval note="Go only after one of them approves it." />;
  }

  const ready = where && date && symptoms.trim() && (where === "RSI" || clinic.trim());

  return (
    <div className="flex flex-col gap-5">
      <Header title="Report sick" hint="Your PC or PS approves it. Go only after they do." />
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (where) call(() => reportSick({ where, date, clinic, symptoms }), setResult);
        }}
      >
        <Step n={1} title="Where">
          <Field label="Where are you reporting sick?">
            <div className="flex flex-col gap-2">
              <Choice on={where === "RSI"} onClick={() => setWhere("RSI")}>
                <Tent className="size-4 shrink-0 text-muted-foreground" aria-hidden /> In camp (RSI)
              </Choice>
              <Choice on={where === "RSO"} onClick={() => setWhere("RSO")}>
                <Hospital className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Outside camp (RSO)
              </Choice>
            </div>
          </Field>
        </Step>

        {where && (
          <>
            <Step n={2} title="When">
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
                  <Input id="clinic" value={clinic} onChange={(e) => setClinic(e.target.value)} placeholder="e.g. Raffles Medical, Bedok" className={fieldClass} maxLength={100} />
                </Field>
              )}
            </Step>
            <Step n={3} title="Symptoms">
              <Field label="What's wrong?" hint="Your symptoms, briefly. Your PC and PS see this." htmlFor="symptoms">
                <Textarea id="symptoms" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Fever and sore throat since last night" className={textareaClass} maxLength={300} />
              </Field>
            </Step>
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
