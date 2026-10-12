"use client";

import { Ban, Check, PenLine, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/shared";
import { decideRecord, giveReason, undoDecision, voidEntry, withdrawRecord } from "@/lib/wb/actions/records";
import type { RecordAccess } from "@/lib/wb/domain/rules";
import { BigButton, ErrorBox, textareaClass, useAction } from "./form-bits";

// The buttons a viewer may use on one record. The server works out `can`
// (lib/wb/domain/rules accessTo) and the decision core checks it all again.

type Open = null | "reject" | "void" | "why" | "withdraw";

export function RecordActions({ recordId, can }: { recordId: string; can: RecordAccess }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [text, setText] = useState("");
  const { pending, error, call } = useAction();

  const act = (fn: () => Promise<ActionResult<{ state: string }>>, done: string) =>
    call(fn, () => {
      toast.success(done);
      setOpen(null);
      setText("");
      router.refresh();
    });

  const any = can.decide || can.undo || can.sayWhy || can.void || can.withdraw;
  if (!any) return null;

  const note = (label: string, placeholder: string) => (
    <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label} className={textareaClass} maxLength={300} />
  );

  return (
    <div className="flex flex-col gap-2">
      {can.decide && open === null && (
        <div className="grid grid-cols-2 gap-2">
          <BigButton pending={pending} onClick={() => act(() => decideRecord({ recordId, action: "approve" }), "Approved")}>
            <Check aria-hidden /> Approve
          </BigButton>
          <BigButton variant="outline" onClick={() => setOpen("reject")}>
            <X aria-hidden /> Reject
          </BigButton>
        </div>
      )}
      {open === "reject" && (
        <div className="tg-reveal flex flex-col gap-2">
          {note("Why not? (optional)", "Why not? Optional: they'll see it.")}
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="destructive" pending={pending} onClick={() => act(() => decideRecord({ recordId, action: "reject", note: text }), "Rejected")}>
              Reject
            </BigButton>
            <BigButton variant="outline" onClick={() => setOpen(null)}>
              Back
            </BigButton>
          </div>
        </div>
      )}

      {can.sayWhy && open === null && (
        <BigButton variant="outline" onClick={() => setOpen("why")}>
          <PenLine aria-hidden /> Say why
        </BigButton>
      )}
      {open === "why" && (
        <div className="tg-reveal flex flex-col gap-2">
          {note("Why not?", "Why not? They'll see it as you wrote it.")}
          <BigButton pending={pending} disabled={!text.trim()} onClick={() => act(() => giveReason({ recordId, note: text }), "Sent")}>
            Send the reason
          </BigButton>
        </div>
      )}

      {can.undo && open === null && (
        <BigButton variant="outline" pending={pending} onClick={() => act(() => undoDecision({ recordId }), "Taken back")}>
          <Undo2 aria-hidden /> Undo my decision
        </BigButton>
      )}

      {can.withdraw && open === null && (
        <BigButton variant="outline" onClick={() => setOpen("withdraw")}>
          Withdraw this request
        </BigButton>
      )}
      {open === "withdraw" && (
        <div className="tg-reveal grid grid-cols-2 gap-2">
          <BigButton variant="destructive" pending={pending} onClick={() => act(() => withdrawRecord({ recordId }), "Withdrawn")}>
            Withdraw it
          </BigButton>
          <BigButton variant="outline" onClick={() => setOpen(null)}>
            Keep it
          </BigButton>
        </div>
      )}

      {can.void && open === null && (
        <BigButton variant="outline" onClick={() => setOpen("void")}>
          <Ban aria-hidden /> Void…
        </BigButton>
      )}
      {open === "void" && (
        <div className="tg-reveal flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">It comes off the timeline and they&apos;re told. Approved leave goes back to them.</p>
          {note("Why are you voiding it?", "Why? e.g. entered twice")}
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="destructive" pending={pending} disabled={text.trim().length < 3} onClick={() => act(() => voidEntry({ recordId, reason: text }), "Voided")}>
              Void it
            </BigButton>
            <BigButton variant="outline" onClick={() => setOpen(null)}>
              Keep it
            </BigButton>
          </div>
        </div>
      )}

      <ErrorBox error={error} />
    </div>
  );
}
