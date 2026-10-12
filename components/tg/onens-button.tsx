"use client";

import { CloudUpload } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markUploaded } from "@/lib/wb/actions/medical";
import { BigButton, ErrorBox, useAction } from "./form-bits";

/** "Uploaded to ONENS": the trooper on his own MC, or his PC/PS from the owed list. */
export function OnensButton({ recordId, label = "Uploaded to ONENS" }: { recordId: string; label?: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <BigButton
        variant="outline"
        pending={pending}
        onClick={() =>
          call(
            () => markUploaded({ recordId }),
            () => {
              toast.success("Marked as uploaded");
              router.refresh();
            },
          )
        }
      >
        <CloudUpload aria-hidden /> {label}
      </BigButton>
      <ErrorBox error={error} />
    </div>
  );
}
