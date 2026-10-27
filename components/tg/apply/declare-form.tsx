"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { declareStatuses, noStatuses } from "@/lib/wb/actions/medical";
import { BigLink, DoneScreen, ErrorBox, Field, Header, Step, Submit, useAction, YesNo } from "../form-bits";
import { PhotoPicker } from "../photo-picker";
import { blankStatus, StatusCard, StatusCount, statusInput, statusMissing, type StatusAnswers } from "./status-fields";

// Statuses he already had when he joined Sabre (2026-10-27). Permanent ones
// from any date, temporary ones still running; the paper is optional, since an
// old one is often long gone. "No" only stops Home asking.

export function DeclareForm({ today, fromRegister }: { today: string; fromRegister: boolean }) {
  const router = useRouter();
  const [has, setHas] = useState<boolean | null>(null);
  const [statuses, setStatuses] = useState<StatusAnswers[]>([blankStatus(today)]);
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { pending, error, call } = useAction();
  const setStatus = (i: number, patch: Partial<StatusAnswers>) => setStatuses(statuses.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (done) {
    return (
      <DoneScreen title="Saved" line="Your commanders can see your statuses. A status keeps you present on the parade state.">
        <BigLink href="/tg/records">My records</BigLink>
        <BigLink href="/tg" outline>
          Home
        </BigLink>
      </DoneScreen>
    );
  }

  const missing =
    has === null
      ? "Answer the question first."
      : !has
        ? null
        : statuses.map((s, i) => statusMissing(s, i, statuses.length) ?? (!s.permanent && s.endDate < today ? `${statuses.length > 1 ? `Status ${i + 1}` : "That status"} has already ended. Only add statuses you still have.` : null)).find(Boolean) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Statuses you already have"
        hint={`${fromRegister ? "Last step. " : ""}Permanent ones, or temporary ones still running. Your commanders see them.`}
      />
      <form
        className="flex flex-col gap-7"
        onSubmit={(e) => {
          e.preventDefault();
          if (!has) call(noStatuses, () => (router.replace("/tg"), router.refresh()));
          else call(() => declareStatuses({ statuses: statuses.map(statusInput), photoToken }), () => setDone(true));
        }}
      >
        <Step n={1} title="Any statuses?">
          <YesNo label="Do you have any statuses right now?" value={has} onChange={setHas} />
        </Step>

        {has && (
          <>
            <Step n={2} title="Statuses">
              <StatusCount label="How many?" statuses={statuses} today={today} onChange={setStatuses} />
              {statuses.map((s, i) => (
                <StatusCard key={i} s={s} i={i} count={statuses.length} onChange={(patch) => setStatus(i, patch)} />
              ))}
            </Step>
            <Step n={3} title="Photo (optional)">
              <Field label="A photo of the status paper" hint="If you still have it. One photo for all of them.">
                <PhotoPicker onToken={setPhotoToken} />
              </Field>
            </Step>
          </>
        )}

        {has !== null && (
          <Submit pending={pending} missing={missing}>
            {has ? "Save" : fromRegister ? "No statuses. Done" : "No statuses"}
          </Submit>
        )}
      </form>
      <ErrorBox error={error} />
    </div>
  );
}
