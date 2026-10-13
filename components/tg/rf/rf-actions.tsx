"use client";

import { Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { closeRequest, standDownMan } from "@/lib/wb/actions/rf";
import { BigButton, ErrorBox, useAction } from "../form-bits";

// Close a request, and stand a man down. The server checks who may, again.

export function CloseRequest({ requestId, sent }: { requestId: string; sent: number }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const { pending, error, call } = useAction();
  if (!asking) {
    return (
      <BigButton variant="outline" onClick={() => setAsking(true)}>
        <X aria-hidden /> Close: no longer needed
      </BigButton>
    );
  }
  return (
    <div className="tg-reveal flex flex-col gap-2 rounded-2xl bg-card p-4">
      <p className="text-sm">
        Nobody else will be sent.
        {sent ? ` The ${sent === 1 ? "man" : `${sent} men`} already sent stay${sent === 1 ? "s" : ""} on it: stand ${sent === 1 ? "him" : "them"} down below if ${sent === 1 ? "he isn't" : "they aren't"} needed either.` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <BigButton
          variant="destructive"
          pending={pending}
          onClick={() =>
            call(
              () => closeRequest(requestId),
              () => {
                toast.success("Closed");
                setAsking(false);
                router.refresh();
              },
            )
          }
        >
          Close it
        </BigButton>
        <BigButton variant="outline" onClick={() => setAsking(false)}>
          Back
        </BigButton>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export function StandDown({ assignmentId, name }: { assignmentId: string; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const { pending, error, call } = useAction();
  return (
    <div className="flex flex-col gap-2">
      {asking ? (
        <div className="tg-reveal grid grid-cols-2 gap-2">
          <BigButton
            variant="destructive"
            pending={pending}
            onClick={() =>
              call(
                () => standDownMan(assignmentId),
                () => {
                  toast.success(`${name} stood down`);
                  router.refresh();
                },
              )
            }
          >
            Stand down
          </BigButton>
          <BigButton variant="outline" onClick={() => setAsking(false)}>
            Back
          </BigButton>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="tg-press flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-medium text-destructive active:bg-muted">
          <Undo2 className="size-4" aria-hidden /> Stand down
        </button>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
