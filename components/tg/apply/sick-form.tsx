"use client";

import { Hospital, Tent } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reportSick, reportSickFor, type Reported, type Submitted } from "@/lib/wb/actions/records";
import { addDays } from "@/lib/wb/domain/timeline";
import { Choice, Done, ErrorBox, Field, fieldClass, Header, inputClass, Step, Submit, textareaClass, useAction } from "../form-bits";
import type { ForMan, ReportedItem } from "@/lib/wb/report-for";
import { AlreadyReported, ReportedDone } from "./for-man";

// Report sick (ports Sabre Bot's SICK): where, which day, the clinic for an
// RSO, and what's wrong. Nearly everyone reports sick for today, so that's the
// default. His PC or PS approves it before he goes (a PS's goes to the PC, a
// PC's to OC/2IC/CSM; OC/2IC/CSM need no approval: `approver` is null).
//
// `forMan`: a commander reporting for one of his men (2026-10-24), as far
// back as yesterday; saved approved if he could approve it himself. `reported`:
// on the man's own form, the days someone already reported for him.

export function SickForm({
  today,
  approver,
  forMan,
  reported = [],
}: {
  today: string;
  approver: string | null;
  forMan?: ForMan;
  reported?: ReportedItem[];
}) {
  const [where, setWhere] = useState<"RSI" | "RSO" | null>(null);
  const [date, setDate] = useState(today);
  const [clinic, setClinic] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [result, setResult] = useState<Submitted | null>(null);
  const [done, setDone] = useState<Reported | null>(null);
  const { pending, error, call } = useAction();

  if (done) return <ReportedDone result={done} title={done.approved ? "Reported and approved" : "Sent to his PC or PS"} />;
  if (result?.approved) {
    return <Done title="Recorded" delivery={result.delivery} subunitName={result.subunitName} needsApproval={false} note="No approval needed. Go now, then tap Update outcome in the bot's message." />;
  }
  if (result) {
    return <Done title="Sent to your commanders" delivery={result.delivery} subunitName={result.subunitName} needsApproval note="Go only after one of them approves it." />;
  }

  const earliest = forMan ? addDays(today, -1) : today;
  const already = where ? reported.find((r) => (r.kind === "RSI" || r.kind === "RSO") && r.date === date) : undefined;
  const missing = !date
    ? "Pick the day."
    : date < earliest
      ? forMan
        ? "As far back as yesterday only."
        : "Pick today or a later day."
      : already
        ? "That day is already reported (see above)."
        : where === "RSO" && !clinic.trim()
          ? "Say which clinic or hospital."
          : !symptoms.trim()
            ? forMan
              ? "Say what's wrong with him."
              : "Say what's wrong."
            : null;
  const hint = forMan
    ? forMan.approvesOnSave
      ? `You can approve it, so it's saved approved. ${forMan.who} is told.`
      : `His PC or PS approves it. ${forMan.who} is told.`
    : approver
      ? `${approver[0].toUpperCase()}${approver.slice(1)} approves it. Go only after they do.`
      : "No approval needed: it's recorded as soon as you send it.";

  return (
    <div className="flex flex-col gap-5">
      <Header title={forMan ? `Report sick for ${forMan.who}` : "Report sick"} hint={hint} />
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!where) return;
          if (forMan) call(() => reportSickFor({ personId: forMan.personId, where, date, clinic, symptoms }), setDone);
          else call(() => reportSick({ where, date, clinic, symptoms }), setResult);
        }}
      >
        <Step n={1} title="Where">
          <Field label={forMan ? "Where is he reporting sick?" : "Where are you reporting sick?"}>
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
              <Field label={where === "RSI" || forMan ? "Which day?" : "Which day are you going?"}>
                <div className={`grid gap-2 ${forMan ? "grid-cols-3" : "grid-cols-2"}`}>
                  {forMan && (
                    <Choice on={date === earliest} onClick={() => setDate(earliest)}>
                      Yesterday
                    </Choice>
                  )}
                  <Choice on={date === today} onClick={() => setDate(today)}>
                    Today
                  </Choice>
                  <Choice on={date === addDays(today, 1)} onClick={() => setDate(addDays(today, 1))}>
                    Tomorrow
                  </Choice>
                </div>
                <input type="date" required className={inputClass} value={date} min={earliest} aria-label="Day" onChange={(e) => setDate(e.target.value)} />
              </Field>
              {where === "RSO" && (
                <Field label="Which clinic or hospital?" htmlFor="clinic">
                  <Input id="clinic" value={clinic} onChange={(e) => setClinic(e.target.value)} placeholder="e.g. Raffles Medical, Bedok" className={fieldClass} maxLength={100} />
                </Field>
              )}
            </Step>
            {already && <AlreadyReported r={already} />}
            <Step n={3} title="Symptoms">
              <Field label={forMan ? "What's wrong with him?" : "What's wrong?"} hint={forMan ? "His symptoms, briefly. His PC and PS see this." : "Your symptoms, briefly. Your PC and PS see this."} htmlFor="symptoms">
                <Textarea id="symptoms" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Fever and sore throat since last night" className={textareaClass} maxLength={300} />
              </Field>
            </Step>
            <Submit pending={pending} missing={missing}>
              {forMan ? "Report it" : "Send to my commanders"}
            </Submit>
          </>
        )}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}
