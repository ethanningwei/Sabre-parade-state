"use client";

import { Building2, ExternalLink, House, MapPin } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendClaim } from "@/lib/wb/actions/claims";
import { claimDays, MAX_PLACE, MAX_REASON, VEHICLE_TYPES, type Place, type Vehicle } from "@/lib/wb/domain/claims";
import { addDays, dayMonth } from "@/lib/wb/domain/timeline";
import { bigButtonClass, BigLink, Choice, DoneScreen, ErrorBox, Field, fieldClass, Header, inputClass, Step, Submit, useAction, YesNo } from "../form-bits";

// Transport claim (ports Sabre Bot's CLAIM, which replaced the Form SG): six
// questions, four of them taps. Rank, name and platoon come from the roster.
// The places are buttons because typed freely, one camp reached the OC's
// sheet four ways, and his job there is to glance down a column.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
const VEHICLE_LABEL: Record<Vehicle, string> = { "PRIVATE HIRE VEHICLE": "Private hire (Grab, Gojek)", TAXI: "Taxi", BUS: "Bus", MRT: "MRT" };

type Kind = Place["kind"] | null;

function PlaceQuestion({ label, office, kind, text, onKind, onText }: { label: string; office: string; kind: Kind; text: string; onKind: (k: Kind) => void; onText: (t: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex flex-col gap-2">
        <Choice on={kind === "HOME"} onClick={() => onKind("HOME")}>
          <House className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Home
        </Choice>
        <Choice on={kind === "OFFICE"} onClick={() => onKind("OFFICE")}>
          <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Office: {office}
        </Choice>
        <Choice on={kind === "OTHER"} onClick={() => onKind("OTHER")}>
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Somewhere else
        </Choice>
        {kind === "OTHER" && (
          <Input
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="e.g. SINGAPORE GENERAL HOSPITAL"
            autoCapitalize="characters"
            aria-label={`${label}: where`}
            className={`tg-reveal ${fieldClass}`}
            maxLength={MAX_PLACE}
          />
        )}
      </div>
    </Field>
  );
}

const place = (kind: Kind, text: string): Place | null => (kind === "OTHER" ? { kind, text } : kind ? { kind } : null);

export function ClaimForm({ today, office, sheetReady }: { today: string; office: string; sheetReady: boolean }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [first, setFirst] = useState(today);
  const [more, setMore] = useState<boolean | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [start, setStart] = useState<Kind>(null);
  const [startText, setStartText] = useState("");
  const [end, setEnd] = useState<Kind>(null);
  const [endText, setEndText] = useState("");
  const [reason, setReason] = useState("");
  const [roundTrip, setRoundTrip] = useState<boolean | null>(null);
  const [done, setDone] = useState<{ days: string[]; sheet: "sent" | "not-set" | "failed"; url: string | null } | null>(null);
  const { pending, error, call } = useAction();

  if (done) {
    const n = done.days.length;
    const what = n === 1 ? `Your claim for ${dayMonth(done.days[0])}` : `Your ${n} claims (${done.days.map(dayMonth).join(", ")})`;
    const ok = done.sheet === "sent";
    return (
      <DoneScreen
        title={ok ? (n === 1 ? "Claim sent to the OC" : `${n} claims sent to the OC`) : "Saved"}
        tone={ok ? "ok" : "warn"}
        line={
          ok
            ? `${what} ${n === 1 ? "is" : "are"} on the OC's sheet. He decides there; you'll see it in My claims, and get a message in the evening.`
            : done.sheet === "not-set"
              ? `${what} ${n === 1 ? "is" : "are"} saved, but the OC's sheet isn't connected to Sabre yet. Tell an ASA.`
              : `${what} ${n === 1 ? "is" : "are"} saved, but the OC's sheet couldn't be reached. Sabre tries again this evening.`
        }
      >
        <BigLink href="/tg/claims">My claims</BigLink>
        {done.url && done.sheet === "sent" && (
          <a href={done.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "lg", variant: "outline", className: bigButtonClass })}>
            <ExternalLink aria-hidden /> Open the OC&apos;s sheet
          </a>
        )}
        <BigLink href="/tg" outline>
          Home
        </BigLink>
      </DoneScreen>
    );
  }

  const startPlace = place(start, startText);
  const endPlace = place(end, endText);
  const complete =
    vehicle && first >= today && more !== null && (!more || also.length > 0) && startPlace && endPlace && (start !== "OTHER" || startText.trim()) && (end !== "OTHER" || endText.trim()) && reason.trim() && roundTrip !== null;

  const submit = () =>
    call(
      () => sendClaim({ vehicle: vehicle!, first, also: more ? also : [], start: startPlace!, end: endPlace!, reason, roundTrip: roundTrip! }),
      setDone,
    );

  return (
    <form
      className="flex flex-col gap-7"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Header title="Transport claim" hint="Asked for before the trip. The OC approves it on his sheet, as with the Form SG." />
      {!sheetReady && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm">The OC&apos;s sheet isn&apos;t connected yet. Your claim will be saved and sent once it is.</p>
      )}

      <Step n={1} title="How will you travel?">
        <div className="grid grid-cols-2 gap-2">
          {VEHICLE_TYPES.map((v) => (
            <Choice key={v} on={vehicle === v} onClick={() => setVehicle(v)}>
              {VEHICLE_LABEL[v]}
            </Choice>
          ))}
        </div>
      </Step>

      <Step n={2} title="Which day is the trip?" hint="Today or later: a claim is approved before the trip.">
        <div className="grid grid-cols-2 gap-2">
          <Choice on={first === today} onClick={() => (setFirst(today), setAlso([]))}>
            Today
          </Choice>
          <Choice on={first === addDays(today, 1)} onClick={() => (setFirst(addDays(today, 1)), setAlso([]))}>
            Tomorrow
          </Choice>
        </div>
        <input
          type="date"
          required
          className={inputClass}
          value={first}
          min={today}
          aria-label="Day of the trip"
          onChange={(e) => {
            setFirst(e.target.value);
            setAlso([]);
          }}
        />
      </Step>

      <Step n={3} title="Same trip on other days as well?" hint="Each day goes to the OC as its own row, because that's how he approves them.">
        <div className="grid grid-cols-2 gap-2">
          <Choice on={more === false} onClick={() => setMore(false)}>
            Just that day
          </Choice>
          <Choice on={more === true} onClick={() => setMore(true)}>
            Other days too
          </Choice>
        </div>
        {more && first && (
          <div className="tg-reveal tg-rows overflow-hidden rounded-2xl bg-card">
            {claimDays(first).map((d) => {
              const on = also.includes(d);
              return (
                <label key={d} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 transition-colors duration-150 active:bg-muted">
                  <input type="checkbox" className="size-5 accent-primary" checked={on} onChange={() => setAlso(on ? also.filter((x) => x !== d) : [...also, d].sort())} />
                  <span className="flex-1 tabular-nums">
                    {weekday(d)} {dayMonth(d)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {more && also.length === 0 && <p className="px-1 text-xs text-muted-foreground">Tick at least one more day, or choose Just that day.</p>}
      </Step>

      <Step n={4} title="Where does it start and end?" hint="Home needs no address: the OC isn't going there.">
        <PlaceQuestion label="Start" office={office} kind={start} text={startText} onKind={setStart} onText={setStartText} />
        <PlaceQuestion label="End" office={office} kind={end} text={endText} onKind={setEnd} onText={setEndText} />
      </Step>

      <Step n={5} title="What is it for?">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. CT SCAN, OSE & COMD TRAINING" autoCapitalize="characters" aria-label="What it's for" className={fieldClass} maxLength={MAX_REASON} />
      </Step>

      <Step n={6} title="Is it a round trip?">
        <YesNo label="There and back again" value={roundTrip} onChange={setRoundTrip} />
      </Step>

      <Submit pending={pending} disabled={!complete}>
        {more && also.length ? `Send ${also.length + 1} claims to the OC` : "Send to the OC"}
      </Submit>
      <ErrorBox error={error} />
    </form>
  );
}
