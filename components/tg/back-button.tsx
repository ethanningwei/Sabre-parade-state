"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmBackOnRecord } from "@/lib/wb/actions/records";
import { BigButton, ErrorBox, useAction } from "./form-bits";

// A record that has ended and is still on the parade state: his GC, PC or PS
// says he's back, as the evening "🏠 Back?" does. The server checks who again.

export function BackButton({ projectionId, label }: { projectionId: string; label: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <BigButton
        variant="outline"
        pending={pending}
        onClick={() =>
          call(
            () => confirmBackOnRecord(projectionId),
            (r) => {
              toast.success(r.closed ? `${r.label}: marked present` : `${r.label}: noted, marked present when it ends`);
              router.refresh();
            },
          )
        }
      >
        ✅ {label} is back
      </BigButton>
      <ErrorBox error={error} />
    </div>
  );
}
