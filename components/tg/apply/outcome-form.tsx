"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordOutcome } from "@/lib/wb/actions/medical";
import { MC_CATEGORIES, STATUSES } from "@/lib/wb/domain/roles";
import { asksSeenBy, MAX_STATUSES, type WbSeenBy } from "@/lib/wb/domain/rules";
import { Choice, ErrorBox, Field, Header, inputClass, Submit, useAction, YesNo } from "../form-bits";
import { PhotoPicker } from "../photo-picker";

// What the doctor gave him (ports Sabre Bot's OUTCOME). Two plain yes/no
// questions first, so a man who got neither answers twice and is done. Then
// the MC or HL, each status on the paper, one photo of that paper, and, only
// for a civilian doctor's MC, whether it's on ONENS yet.

export type VisitKind = "RSI" | "RSO" | "MA";

export interface StatusAnswers {
  permanent: boolean | null;
  type: string;
  other: string;
  startDate: string;
  endDate: string;
}

export interface OutcomeAnswers {
  gotMc: boolean | null;
  gotStatus: boolean | null;
  mcKind: "MC" | "HL";
  category: string;
  diagnosis: string;
  mcStart: string;
  mcEnd: string;
  seenBy: WbSeenBy | null;
  statuses: StatusAnswers[];
  onensUploaded: boolean | null;
}

export const blankStatus = (today: string): StatusAnswers => ({ permanent: null, type: "", other: "", startDate: today, endDate: today });

export const blankOutcome = (today: string): OutcomeAnswers => ({
  gotMc: null,
  gotStatus: null,
  mcKind: "MC",
  category: "",
  diagnosis: "",
  mcStart: today,
  mcEnd: today,
  seenBy: null,
  statuses: [],
  onensUploaded: null,
});

export function OutcomeForm({
  today,
  anchorId,
  parentKind,
  visitLine,
  initial,
  hasPhoto,
}: {
  today: string;
  /** the visit, or a standalone outcome being corrected; null for a new standalone one */
  anchorId: string | null;
  /** the visit's kind; null when there's no RSI/RSO/MA above it */
  parentKind: VisitKind | null;
  visitLine?: string;
  /** set when correcting: what's recorded now */
  initial?: OutcomeAnswers;
  hasPhoto: boolean;
}) {
  const [a, setA] = useState<OutcomeAnswers>(initial ?? blankOutcome(today));
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [done, setDone] = useState<{ anchorId: string; nothing: boolean } | null>(null);
  const { pending, error, call } = useAction();
  const set = (patch: Partial<OutcomeAnswers>) => setA((x) => ({ ...x, ...patch }));
  const setStatus = (i: number, patch: Partial<StatusAnswers>) => set({ statuses: a.statuses.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const correcting = !!initial;

  if (done) return <Recorded {...done} />;

  const nothing = a.gotMc === false && a.gotStatus === false;
  const seenAsked = !!a.gotMc && asksSeenBy(parentKind);
  const onensAsked = !!a.gotMc && (parentKind === "RSO" || (seenAsked && a.seenBy === "CIVILIAN"));
  const mcOk = !a.gotMc || (a.category && a.diagnosis.trim() && a.mcStart && a.mcEnd && a.mcEnd >= a.mcStart && (!seenAsked || a.seenBy));
  const statusesOk =
    !a.gotStatus ||
    (a.statuses.length > 0 &&
      a.statuses.every((s) => s.permanent !== null && s.type && (s.type !== "OTHER" || s.other.trim()) && s.startDate && (s.permanent || (s.endDate && s.endDate >= s.startDate))));
  const photoOk = nothing || photoToken || (correcting && hasPhoto);
  const ready = a.gotMc !== null && a.gotStatus !== null && (!nothing || !!anchorId) && mcOk && statusesOk && photoOk && (!onensAsked || a.onensUploaded !== null);

  const submit = () =>
    call(
      () =>
        recordOutcome({
          anchorId,
          mc: a.gotMc
            ? { kind: a.mcKind, category: a.category as (typeof MC_CATEGORIES)[number], diagnosis: a.diagnosis, startDate: a.mcStart, endDate: a.mcEnd, seenBy: seenAsked ? a.seenBy : null }
            : null,
          statuses: a.gotStatus
            ? a.statuses.map((s) => ({ permanent: !!s.permanent, type: s.type as (typeof STATUSES)[number], other: s.other, startDate: s.startDate, endDate: s.permanent ? null : s.endDate }))
            : [],
          photoToken,
          onensUploaded: onensAsked && !!a.onensUploaded,
        }),
      (res) => setDone({ anchorId: res.anchorId, nothing: res.nothing }),
    );

  return (
    <div className="flex flex-col gap-5">
      <Header
        title={correcting ? "Correct the outcome" : "What did the doctor give you?"}
        hint={correcting ? "Saving replaces what's recorded now. Your commanders see both." : visitLine}
      />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <YesNo label="Did you get MC or hospitalisation leave?" value={a.gotMc} onChange={(v) => set({ gotMc: v })} />
        <YesNo
          label="Did you get any status?"
          value={a.gotStatus}
          onChange={(v) => set({ gotStatus: v, statuses: v && !a.statuses.length ? [blankStatus(today)] : a.statuses })}
        />

        {a.gotMc && (
          <section className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            <Field label="Which did you get?">
              <div className="grid grid-cols-2 gap-2">
                <Choice on={a.mcKind === "MC"} onClick={() => set({ mcKind: "MC" })}>
                  MC
                </Choice>
                <Choice on={a.mcKind === "HL"} onClick={() => set({ mcKind: "HL" })}>
                  Hospitalisation leave
                </Choice>
              </div>
            </Field>
            <Field label={`What was the ${a.mcKind} for?`} hint="Your commanders see this, never the diagnosis.">
              <select className={inputClass} value={a.category} aria-label="Category" onChange={(e) => set({ category: e.target.value })}>
                <option value="" disabled>
                  Pick one
                </option>
                {MC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="What's the diagnosis?" hint="Copy what the doctor wrote, e.g. ACUTE GASTRITIS. Only you, your PC and PS, and OC, 2IC and CSM can see it." htmlFor="dx">
              <Input id="dx" value={a.diagnosis} onChange={(e) => set({ diagnosis: e.target.value })} autoCapitalize="characters" className="h-11 text-base" maxLength={200} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First day">
                <input type="date" required className={inputClass} value={a.mcStart} aria-label="First day" onChange={(e) => set({ mcStart: e.target.value, mcEnd: e.target.value > a.mcEnd ? e.target.value : a.mcEnd })} />
              </Field>
              <Field label="Last day">
                <input type="date" required className={inputClass} value={a.mcEnd} min={a.mcStart} aria-label="Last day" onChange={(e) => set({ mcEnd: e.target.value })} />
              </Field>
            </div>
            {seenAsked && (
              <Field label="Who did you see?">
                <div className="grid grid-cols-2 gap-2">
                  <Choice on={a.seenBy === "MO"} onClick={() => set({ seenBy: "MO", onensUploaded: null })}>
                    The camp MO
                  </Choice>
                  <Choice on={a.seenBy === "CIVILIAN"} onClick={() => set({ seenBy: "CIVILIAN" })}>
                    A civilian doctor
                  </Choice>
                </div>
              </Field>
            )}
          </section>
        )}

        {a.gotStatus && (
          <section className="flex flex-col gap-4">
            <Field label="How many statuses did you get?">
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: MAX_STATUSES }, (_, i) => i + 1).map((n) => (
                  <Choice
                    key={n}
                    on={a.statuses.length === n}
                    onClick={() => set({ statuses: Array.from({ length: n }, (_, i) => a.statuses[i] ?? blankStatus(today)) })}
                  >
                    <span className="w-full text-center">{n}</span>
                  </Choice>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">More than {MAX_STATUSES}? Record these, then the rest as a second entry.</p>
            </Field>
            {a.statuses.map((s, i) => (
              <div key={i} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
                <p className="font-medium">
                  Status {i + 1} of {a.statuses.length}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Choice on={s.permanent === false} onClick={() => setStatus(i, { permanent: false })}>
                    Temporary
                  </Choice>
                  <Choice on={s.permanent === true} onClick={() => setStatus(i, { permanent: true })}>
                    Permanent
                  </Choice>
                </div>
                <Field label="Which status?">
                  <div className="flex flex-col gap-2">
                    {STATUSES.map((t) => (
                      <Choice key={t} on={s.type === t} onClick={() => setStatus(i, { type: t })}>
                        {t}
                      </Choice>
                    ))}
                    <Choice on={s.type === "OTHER"} onClick={() => setStatus(i, { type: "OTHER" })}>
                      Something else
                    </Choice>
                  </div>
                </Field>
                {s.type === "OTHER" && (
                  <Field label="As written on the paper" htmlFor={`st${i}`}>
                    <Input id={`st${i}`} value={s.other} onChange={(e) => setStatus(i, { other: e.target.value })} placeholder="e.g. EXCUSE LOWER LIMB" autoCapitalize="characters" className="h-11 text-base" maxLength={60} />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From">
                    <input type="date" required className={inputClass} value={s.startDate} aria-label={`Status ${i + 1} from`} onChange={(e) => setStatus(i, { startDate: e.target.value, endDate: e.target.value > s.endDate ? e.target.value : s.endDate })} />
                  </Field>
                  {s.permanent !== true && (
                    <Field label="Until">
                      <input type="date" required className={inputClass} value={s.endDate} min={s.startDate} aria-label={`Status ${i + 1} until`} onChange={(e) => setStatus(i, { endDate: e.target.value })} />
                    </Field>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {(a.gotMc || a.gotStatus) && (
          <Field label="A photo of the document" hint="One photo: the MC and statuses are on the same paper.">
            <PhotoPicker onToken={setPhotoToken} keepLabel={correcting && hasPhoto ? "Or keep the photo you sent before." : undefined} />
          </Field>
        )}

        {onensAsked && <YesNo label="Have you uploaded it to ONENS?" value={a.onensUploaded} onChange={(v) => set({ onensUploaded: v })} yes="Yes" no="Not yet" />}

        {a.gotMc !== null && a.gotStatus !== null && (
          <Submit pending={pending} disabled={!ready}>
            {nothing ? (anchorId ? "Nothing given. Save" : "Nothing to record") : correcting ? "Save the correction" : "Record it"}
          </Submit>
        )}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

function Recorded({ anchorId, nothing }: { anchorId: string; nothing: boolean }) {
  return (
    <section className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircle2 className="size-12 text-emerald-600" />
      <h2 className="text-xl font-semibold">{nothing ? "Noted: nothing given" : "Recorded"}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {nothing ? "Nothing else to do." : "Your commanders can see what you got and for how long. The diagnosis and photo stay private."}
      </p>
      <div className="mt-2 flex w-full flex-col gap-2">
        <Link href={`/tg/records/${anchorId}`} className={buttonVariants({ size: "lg", className: "h-11" })}>
          See it
        </Link>
        <Link href="/tg" className={buttonVariants({ size: "lg", variant: "outline", className: "h-11" })}>
          Home
        </Link>
      </div>
    </section>
  );
}
