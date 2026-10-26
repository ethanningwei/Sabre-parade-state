"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "@/lib/toast";
import { Switch } from "@/components/ui/switch";
import { setCampShift } from "@/lib/actions/attendance";

export function ShiftToggle({
  campId,
  campName,
  onShift,
  disabled,
}: {
  campId: string;
  campName: string;
  onShift: boolean;
  disabled?: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(onShift);
  const [, startTransition] = useTransition();

  return (
    <Switch
      checked={optimistic}
      disabled={disabled}
      aria-label={`${campName} on shift`}
      onCheckedChange={(next: boolean) =>
        startTransition(async () => {
          setOptimistic(next);
          const res = await setCampShift(campId, next);
          if (!res.ok) toast.error(res.error);
          else toast.success(`${campName} is now ${next ? "on" : "off"} shift`);
        })
      }
    />
  );
}
