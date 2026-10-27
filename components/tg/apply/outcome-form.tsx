"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { recordOutcome } from "@/lib/wb/actions/medical";
import { MC_CATEGORIES, STATUSES } from "@/lib/wb/domain/roles";
import { asksSeenBy, MAX_STATUSES, type WbSeenBy } from "@/lib/wb/domain/rules";
import { BigLink, Choice, DoneScreen, ErrorBox, Field, fieldClass, Header, inputClass, Step, Submit, useAction, YesNo } from "../form-bits";
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
  // the first thing still to fill in, in the order the form asks, or null
  const statusMissing = (s: StatusAnswers, i: number) => {
    const which = a.statuses.length > 1 ? `Status ${i + 1}: ` : "Status: ";
    if (s.permanent === null) return `${which}pick Temporary or Permanent.`;
    if (!s.type) return `${which}pick which status.`;
    if (s.type === "OTHER" && !s.other.trim()) return `${which}write it as it is on the paper.`;
    if (!s.startDate) return `${which}give the date it starts.`;
    if (!s.permanent && !s.endDate) return `${which}give the date it ends.`;
    if (!s.permanent && s.endDate < s.startDate) return `${which}it can't end before it starts.`;
    return null;
  };
  const missing =
    a.gotMc === null || a.gotStatus === null
      ? "Answer both questions in step 1."
      : nothing && !anchorId
        ? "You got neither, so there's nothing to record."
        : a.gotMc && !a.category
          ? `Pick what the ${a.mcKind} was for.`
          : a.gotMc && !a.diagnosis.trim()
            ? "Fill in the diagnosis."
            : a.gotMc && (!a.mcStart || !a.mcEnd)
              ? `Give the first and last day of the ${a.mcKind}.`
              : a.gotMc && a.mcEnd < a.mcStart
                ? `The ${a.mcKind}'s last day can't be before its first.`
                : seenAsked && !a.seenBy
                  ? "Say who you saw: the camp MO or a civilian doctor."
                  : a.gotStatus && !a.statuses.length
                    ? "Pick how many statuses you got."
                    : (a.gotStatus && a.statuses.map(statusMissing).find(Boolean)) ||
                      (!nothing && !photoToken && !(correcting && hasPhoto)
                        ? "Add a photo of the document. If it's still saving, wait for the tick."
                        : onensAsked && a.onensUploaded === null
                          ? "Say whether you've uploaded it to ONENS."
                          : null);
  // the sections are numbered in the order they open
  let n = 1;
  const num = () => ++n;

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
        className="flex flex-col gap-7"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Step n={1} title="What you got">
          <YesNo label="Did you get MC or hospitalisation leave?" value={a.gotMc} onChange={(v) => set({ gotMc: v })} />
          <YesNo
            label="Did you get any status?"
            value={a.gotStatus}
            onChange={(v) => set({ gotStatus: v, statuses: v && !a.statuses.length ? [blankStatus(today)] : a.statuses })}
          />
        </Step>

        {a.gotMc && (
          <Step n={num()} title={a.mcKind === "HL" ? "Hospitalisation leave" : "MC"}>
            <section className="flex flex-col gap-4 rounded-2xl bg-card p-4">
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
                <Input id="dx" value={a.diagnosis} onChange={(e) => set({ diagnosis: e.target.value })} autoCapitalize="characters" className={fieldClass} maxLength={200} />
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
          </Step>
        )}

        {a.gotStatus && (
          <Step n={num()} title="Statuses">
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
              <div key={i} className="tg-reveal flex flex-col gap-4 rounded-2xl bg-card p-4">
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
                  <div className="tg-reveal">
                    <Field label="As written on the paper" htmlFor={`st${i}`}>
                      <Input id={`st${i}`} value={s.other} onChange={(e) => setStatus(i, { other: e.target.value })} placeholder="e.g. EXCUSE LOWER LIMB" autoCapitalize="characters" className={fieldClass} maxLength={60} />
                    </Field>
                  </div>
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
          </Step>
        )}

        {(a.gotMc || a.gotStatus) && (
          <Step n={num()} title="Photo">
            <Field label="A photo of the document" hint="One photo: the MC and statuses are on the same paper.">
              <PhotoPicker onToken={setPhotoToken} keepLabel={correcting && hasPhoto ? "Or keep the photo you sent before." : undefined} />
            </Field>
          </Step>
        )}

        {onensAsked && (
          <Step n={num()} title="ONENS">
            <YesNo label="Have you uploaded it to ONENS?" value={a.onensUploaded} onChange={(v) => set({ onensUploaded: v })} yes="Yes" no="Not yet" />
          </Step>
        )}

        {a.gotMc !== null && a.gotStatus !== null && (
          <Submit pending={pending} missing={missing}>
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
    <DoneScreen
      title={nothing ? "Noted: nothing given" : "Recorded"}
      line={nothing ? "Nothing else to do." : "Your commanders can see what you got and for how long. The diagnosis and photo stay private."}
    >
      <BigLink href={`/tg/records/${anchorId}`}>See it</BigLink>
      <BigLink href="/tg" outline>
        Home
      </BigLink>
    </DoneScreen>
  );
}
