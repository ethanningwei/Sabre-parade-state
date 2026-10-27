"use client";

import { Minus, Plus, Send } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { raiseRequest } from "@/lib/wb/actions/rf";
import { MAX_NEED, RF_ROLES, type RfRole } from "@/lib/wb/domain/rf";
import { BigLink, Choice, DoneScreen, ErrorBox, Field, Header, hhmm, inputClass, Step, Submit, textareaClass, useAction } from "../form-bits";

// A camp says it'll be short (Sabre Bot's "Ask for manpower"): which camp,
// what it needs, when, and why. The card goes to the camp's platoon and COY HQ.

export interface RaiseCamp {
  id: string;
  name: string;
  subunitName: string;
}

const ROLE_TEXT: Record<RfRole, string> = { GC: "GC", "ST CBT": "ST CBT", "ST SVC": "ST SVC", ANY: "Any role" };

export function RaiseForm({ camps, today }: { camps: RaiseCamp[]; today: string }) {
  const [campId, setCampId] = useState(camps.length === 1 ? camps[0].id : "");
  const [role, setRole] = useState<RfRole | null>(null);
  const [need, setNeed] = useState(1);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<{ requestId: string; delivery: string; chats: number } | null>(null);
  const { pending, error, call } = useAction();
  const camp = camps.find((c) => c.id === campId);

  if (done) {
    const sent = done.delivery === "sent";
    return (
      <DoneScreen
        title={sent ? "Asked" : "Saved"}
        tone={sent ? "ok" : "warn"}
        line={
          sent
            ? `Sent to ${camp?.subunitName ?? "the platoon"}'s commanders${done.chats > 1 ? " and COY HQ" : ""}. You'll get a message as men are sent, and your own copy has Close.`
            : done.delivery === "no-chat"
              ? "Saved on the RF board, but no commanders chat is linked yet. Ask your PC to send /here in it."
              : "Saved on the RF board, but I couldn't post it to the commanders' chat."
        }
      >
        <BigLink href={`/tg/rf/${done.requestId}`}>Open the request</BigLink>
        <BigLink href="/tg/rf" outline>
          RF board
        </BigLink>
      </DoneScreen>
    );
  }

  const missing = !campId
    ? "Pick the camp that needs them."
    : !role
      ? "Pick what it needs."
      : !startDate || !endDate || !startTime || !endTime
        ? "Give from and until, with the times."
        : endDate < startDate
          ? "Until can't be before from."
          : reason.trim().length < 3
            ? "Say why, in a few words."
            : null;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        call(
          () => raiseRequest({ campId, role: role!, need, startDate, startTime: hhmm(startTime), endDate, endTime: hhmm(endTime), reason }),
          (r) => setDone(r),
        );
      }}
    >
      <Header title="Ask for manpower" hint="When a camp will be short. The card goes to its platoon's commanders and COY HQ, who send men from other camps." />
      <Step n={1} title="Which camp needs them?">
        {camps.length === 1 ? (
          <p className="rounded-xl bg-card px-3.5 py-3 font-medium">
            {camps[0].name} <span className="font-normal text-muted-foreground">· {camps[0].subunitName}</span>
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {camps.map((c) => (
              <Choice key={c.id} on={campId === c.id} onClick={() => setCampId(c.id)}>
                {c.name}
              </Choice>
            ))}
          </div>
        )}
      </Step>
      {campId && (
        <Step n={2} title="What does it need?">
          <div className="grid grid-cols-2 gap-2">
            {RF_ROLES.map((r) => (
              <Choice key={r} on={role === r} onClick={() => setRole(r)}>
                {ROLE_TEXT[r]}
              </Choice>
            ))}
          </div>
          <Field label="How many?">
            <div className="flex items-center gap-3">
              <button type="button" aria-label="One fewer" disabled={need <= 1} onClick={() => setNeed(need - 1)} className="tg-press flex size-12 items-center justify-center rounded-xl border bg-card active:bg-muted disabled:opacity-40">
                <Minus className="size-5" aria-hidden />
              </button>
              <span className="min-w-10 text-center text-2xl font-semibold tabular-nums" aria-live="polite">
                {need}
              </span>
              <button type="button" aria-label="One more" disabled={need >= MAX_NEED} onClick={() => setNeed(need + 1)} className="tg-press flex size-12 items-center justify-center rounded-xl border bg-card active:bg-muted disabled:opacity-40">
                <Plus className="size-5" aria-hidden />
              </button>
            </div>
          </Field>
        </Step>
      )}
      {campId && role && (
        <Step n={3} title="When?" hint="From the first shift they're needed to the last. 0000 to 2359 is the whole day.">
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
        </Step>
      )}
      {campId && role && (
        <Step n={4} title="Why?">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. TWO ON MC, ONE ON COURSE" aria-label="Why" className={textareaClass} maxLength={200} autoCapitalize="characters" />
        </Step>
      )}
      <Submit pending={pending} missing={missing}>
        <Send aria-hidden /> Ask for {need} {need === 1 ? "man" : "men"}
      </Submit>
      <ErrorBox error={error} />
    </form>
  );
}
