"use client";

import { ArrowLeftRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { recordHoto } from "@/lib/wb/actions/shifts";
import { BigButton, Choice, ErrorBox, Field, hhmm, inputClass, useAction } from "../form-bits";

/** "Who took over?" for one physical camp, at a time that defaults to now. */
export function HotoPanel({ teams, today, time }: { teams: { id: string; name: string; on: boolean }[]; today: string; time: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  // the team taking over is usually the one off now
  const [campId, setCampId] = useState(teams.find((t) => !t.on)?.id ?? teams[0].id);
  const [date, setDate] = useState(today);
  const [at, setAt] = useState(`${time.slice(0, 2)}:${time.slice(2, 4)}`);
  const name = teams.find((t) => t.id === campId)?.name ?? "";

  return (
    <div className="flex flex-col gap-3">
      {teams.length > 1 && (
        <Field label="Who took over?">
          <div className="grid grid-cols-2 gap-2">
            {teams.map((t) => (
              <Choice key={t.id} on={campId === t.id} onClick={() => setCampId(t.id)}>
                {t.name}
              </Choice>
            ))}
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day" htmlFor={`d-${teams[0].id}`}>
          <input id={`d-${teams[0].id}`} type="date" required className={inputClass} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor={`t-${teams[0].id}`}>
          <input id={`t-${teams[0].id}`} type="time" required className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
      </div>
      <BigButton
        pending={pending}
        onClick={() =>
          call(
            () => recordHoto({ campId, on: true, date, time: hhmm(at) }),
            (r) => {
              toast.success(r.matched ? `Logged: ${name} took over, as the cycle expected.` : `Logged. The cycle has moved${r.alerted ? " and your commanders have been told" : ""}.`);
              router.refresh();
            },
          )
        }
      >
        <ArrowLeftRight aria-hidden /> {name} took over
      </BigButton>
      <ErrorBox error={error} />
    </div>
  );
}
