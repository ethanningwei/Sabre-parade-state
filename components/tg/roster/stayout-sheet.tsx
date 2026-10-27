"use client";

import { House } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { setStayoutAction } from "@/lib/wb/actions/roster";
import { ddmmyy } from "@/lib/parade/time";
import { BigButton, Choice, ErrorBox, Field, fieldClass, useAction } from "../form-bits";
import { TgSheet } from "./tg-sheet";

type Stayout = "NONE" | "PERM" | "TEMP";

/**
 * Person history's stay-out, for his PC or PS and company command: whether
 * he's away from 2100 to 0600 while his camp is on shift (status §3e, A).
 * `label`: "Permanent" / "until 31/10" / "No".
 */
export function StayoutSheet({ personId, name, stayout, until, label }: { personId: string; name: string; stayout: Stayout; until: string | null; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<Stayout>(stayout);
  const [date, setDate] = useState(until ? ddmmyy(until) : "");
  const { pending, error, setError, call } = useAction();

  const show = () => {
    setTo(stayout);
    setDate(until ? ddmmyy(until) : "");
    setError(null);
    setOpen(true);
  };
  const save = () =>
    call(
      () => setStayoutAction(personId, { stayout: to, until: date }),
      () => {
        toast.success(to === "NONE" ? `${name} isn't stay-out` : `${name}'s stay-out saved`);
        setOpen(false);
        router.refresh();
      },
    );

  return (
    <>
      <BigButton variant="outline" onClick={show}>
        <House aria-hidden /> Stay-out: {label}
      </BigButton>
      <TgSheet open={open} onOpenChange={setOpen} title={`${name}: stay-out`} description="Stay-out men are on the parade state from 2100 to 0600 while their camp is on shift.">
        <div className="flex flex-col gap-2">
          <Choice on={to === "NONE"} onClick={() => setTo("NONE")}>
            Not stay-out
          </Choice>
          <Choice on={to === "PERM"} onClick={() => setTo("PERM")}>
            Permanent
          </Choice>
          <Choice on={to === "TEMP"} onClick={() => setTo("TEMP")}>
            Until a date
          </Choice>
        </div>
        {to === "TEMP" && (
          <Field label="Until (DDMMYY)" hint="His last night out.">
            <Input value={date} onChange={(e) => setDate(e.target.value)} inputMode="numeric" placeholder="311026" className={`${fieldClass} font-mono`} />
          </Field>
        )}
        <ErrorBox error={error} />
        <div className="grid grid-cols-2 gap-2">
          <BigButton pending={pending} missing={to === "TEMP" && date.replace(/\D/g, "").length !== 6 ? "Type his last night out as DDMMYY." : null} onClick={save}>
            Save
          </BigButton>
          <BigButton variant="outline" onClick={() => setOpen(false)}>
            Back
          </BigButton>
        </div>
      </TgSheet>
    </>
  );
}
