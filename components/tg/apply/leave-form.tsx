"use client";

import { MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { applyLeave, applyOff, checkClash, type Submitted } from "@/lib/wb/actions/records";
import { holidayOn } from "@/lib/wb/domain/holidays";
import { leaveRefusal } from "@/lib/wb/domain/rules";
import { AL_PLACES, LEAVE_REASONS } from "@/lib/wb/domain/roles";
import { checkRange, dayMonth, daysTouched, type RangeInput } from "@/lib/wb/domain/timeline";
import { BigButton, Choice, ClashStep, Done, ErrorBox, Field, fieldClass, Header, hhmm, inputClass, StepBar, Submit, useAction } from "../form-bits";

// AL, OL and Off (ports Sabre Bot's _leave_steps and OFF). Off stops after
// the clash check; leave goes on to what it costs, where, and why.

type Kind = "AL" | "OL" | "OFF";
type Step = "dates" | "clash" | "days" | "where" | "reason" | "done";

const TITLE: Record<Kind, string> = { AL: "Annual leave", OL: "Overseas leave", OFF: "Off" };
/** Leave's screens, for the step bar (the clash check is part of the dates). Off is one screen. */
const STEPS: { step: Step; label: string; back?: Step }[] = [
  { step: "dates", label: "Dates" },
  { step: "days", label: "Days it costs", back: "dates" },
  { step: "where", label: "Where", back: "days" },
  { step: "reason", label: "What for", back: "where" },
];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];

export function LeaveForm({ kind, today, leaveLeft }: { kind: Kind; today: string; leaveLeft: number }) {
  const [step, setStep] = useState<Step>("dates");
  const [dates, setDates] = useState({ startDate: today, startTime: "00:00", endDate: today, endTime: "23:59" });
  const [clash, setClash] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [result, setResult] = useState<Submitted | null>(null);
  const { pending, error, setError, call } = useAction();

  const input: RangeInput = { ...dates, startTime: hhmm(dates.startTime), endTime: hhmm(dates.endTime) };
  const range = useMemo(() => {
    const r = checkRange(input, today);
    return r.ok ? r.range : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, today]);
  const touched = range ? daysTouched(range) : [];

  const afterClash = () => {
    if (kind === "OFF") return submitOff();
    // every day ticked except public holidays: he unticks what he doesn't owe
    setDays(touched.filter((d) => !holidayOn(d)));
    setStep("days");
  };

  const submitDates = () => {
    const r = checkRange(input, today);
    if (!r.ok) return setError(r.error);
    call(
      () => checkClash(input),
      (lines) => {
        setClash(lines);
        if (lines.length) setStep("clash");
        else afterClash();
      },
    );
  };

  const submitOff = () =>
    call(
      () => applyOff(input),
      (res) => {
        setResult(res);
        setStep("done");
      },
    );

  const submitLeave = () =>
    call(
      () =>
        applyLeave({
          kind: kind as "AL" | "OL",
          ...input,
          days,
          place,
          city,
          country,
          reason: reason as (typeof LEAVE_REASONS)[number] | "OTHER",
          reasonOther,
        }),
      (res) => {
        setResult(res);
        setStep("done");
      },
    );

  if (step === "done" && result) {
    return <Done title="Sent for approval" delivery={result.delivery} subunitName={result.subunitName} needsApproval />;
  }

  const cost = days.length;
  const refusal = leaveRefusal(cost, leaveLeft);
  const at = STEPS.findIndex((x) => x.step === (step === "clash" ? "dates" : step));

  return (
    <div className="flex flex-col gap-5">
      <Header title={TITLE[kind]} hint={kind === "AL" ? "Singapore or Johor Bahru only." : kind === "OL" ? "Anywhere outside Singapore and JB." : undefined} />
      {kind !== "OFF" && at >= 0 && (
        <StepBar
          at={at + 1}
          of={STEPS.length}
          label={STEPS[at].label}
          onBack={STEPS[at].back ? () => setStep(STEPS[at].back!) : undefined}
        />
      )}

      {step === "dates" && (
        <form
          className="tg-reveal flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitDates();
          }}
        >
          <DateTime label="Start" date={dates.startDate} time={dates.startTime} min={today} onDate={(v) => setDates({ ...dates, startDate: v, endDate: v > dates.endDate ? v : dates.endDate })} onTime={(v) => setDates({ ...dates, startTime: v })} />
          <DateTime label="End" date={dates.endDate} time={dates.endTime} min={dates.startDate} onDate={(v) => setDates({ ...dates, endDate: v })} onTime={(v) => setDates({ ...dates, endTime: v })} />
          <p className="px-1 text-xs text-muted-foreground">Times are optional: 0000 to 2359 means whole days.</p>
          <Submit pending={pending}>Next</Submit>
        </form>
      )}

      {step === "clash" && <ClashStep lines={clash} onCarryOn={afterClash} onChange={() => setStep("dates")} />}

      {step === "days" && (
        <section className="tg-reveal flex flex-col gap-3">
          <div className="px-1">
            <p className="font-medium">Which days does this actually cost you?</p>
            <p className="text-sm text-muted-foreground">Untick any day you&apos;re already off shift, or that&apos;s a public holiday.</p>
          </div>
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {touched.map((d) => {
              const on = days.includes(d);
              const holiday = holidayOn(d);
              return (
                <label key={d} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 transition-colors duration-150 active:bg-muted">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={on}
                    onChange={() => setDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
                  />
                  <span className="flex-1 tabular-nums">
                    {weekday(d)} {dayMonth(d)}
                  </span>
                  {holiday && <span className="text-xs text-muted-foreground">{holiday}</span>}
                </label>
              );
            })}
          </div>
          <p className={`px-1 text-sm font-medium tabular-nums ${refusal && cost > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {cost} day{cost === 1 ? "" : "s"} of leave · you have {leaveLeft} left
          </p>
          {refusal && cost > leaveLeft && <p className="px-1 text-xs text-muted-foreground">{refusal}</p>}
          <BigButton onClick={() => setStep("where")} disabled={!!refusal}>
            Next
          </BigButton>
        </section>
      )}

      {step === "where" && (
        <form
          className="tg-reveal flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("reason");
          }}
        >
          {kind === "AL" ? (
            <Field label="Where will you be?" hint="Anywhere further is overseas leave.">
              <div className="flex flex-col gap-2">
                {AL_PLACES.map((p) => (
                  <Choice key={p} on={place === p} onClick={() => setPlace(p)}>
                    <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {p === "SINGAPORE" ? "Staying in Singapore" : "Johor Bahru"}
                  </Choice>
                ))}
              </div>
            </Field>
          ) : (
            <>
              <Field label="Which city?" htmlFor="city">
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. BANGKOK" autoCapitalize="characters" className={fieldClass} />
              </Field>
              <Field label="Which country?" htmlFor="country">
                <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. THAILAND" autoCapitalize="characters" className={fieldClass} />
              </Field>
            </>
          )}
          <Submit pending={false} disabled={kind === "AL" ? !place : !city.trim() || !country.trim()}>
            Next
          </Submit>
        </form>
      )}

      {step === "reason" && (
        <form
          className="tg-reveal flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitLeave();
          }}
        >
          <Field label="What is it for?">
            <div className="grid grid-cols-2 gap-2">
              {[...LEAVE_REASONS, "OTHER"].map((r) => (
                <Choice key={r} on={reason === r} onClick={() => setReason(r)}>
                  {r === "OTHER" ? "Something else" : r}
                </Choice>
              ))}
            </div>
          </Field>
          {reason === "OTHER" && (
            <div className="tg-reveal">
              <Field label="Briefly, what for?" htmlFor="other">
                <Input id="other" value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} className={fieldClass} maxLength={100} />
              </Field>
            </div>
          )}
          <Submit pending={pending} disabled={!reason || (reason === "OTHER" && !reasonOther.trim())}>
            Send for approval
          </Submit>
        </form>
      )}

      <ErrorBox error={error} />
    </div>
  );
}

export function DateTime({
  label,
  date,
  time,
  min,
  onDate,
  onTime,
}: {
  label: string;
  date: string;
  time: string;
  min: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <input type="date" required className={inputClass} value={date} min={min} onChange={(e) => onDate(e.target.value)} aria-label={`${label} date`} />
        <input type="time" required className={inputClass} value={time} onChange={(e) => onTime(e.target.value)} aria-label={`${label} time`} />
      </div>
    </Field>
  );
}
