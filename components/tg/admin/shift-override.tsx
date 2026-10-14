"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { clearCampShift, keepCampShift } from "@/lib/wb/actions/shifts";
import { BigButton, ErrorBox, useAction } from "../form-bits";

// Admin › Projection: keep a weekday camp on or off against its pattern, or
// put it back. The server checks the ADMIN grant again.

export function ShiftOverride({
  campId,
  override,
  offers,
}: {
  campId: string;
  override: { id: string; label: string } | null;
  offers: { on: boolean; label: string }[];
}) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const done = (msg: string) => () => {
    toast.success(msg);
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-2">
      {override ? (
        <BigButton variant="outline" pending={pending} onClick={() => call(() => clearCampShift(override.id), done("Back to its pattern"))}>
          Back to its pattern
        </BigButton>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {offers.map((o) => (
            <BigButton key={String(o.on)} variant="outline" pending={pending} onClick={() => call(() => keepCampShift({ campId, on: o.on }), done(o.label.replace(/^Keep/, "Kept")))}>
              {o.label}
            </BigButton>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
