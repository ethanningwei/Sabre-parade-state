"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProjectionOn, takeOff } from "@/lib/wb/actions/admin";
import { BigButton, ErrorBox, useAction } from "../form-bits";

// Admin › Projection: switch Sabre's ownership of the parade state on or off,
// and take hand-typed entries off it. The server checks the ADMIN grant again.

export function ProjectionSwitch({ on, available }: { on: boolean; available: boolean }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const flip = () =>
    call(
      () => setProjectionOn(!on),
      () => {
        toast.success(on ? "Projection off: the web app edits the parade state" : "Projection on: Sabre owns the parade state");
        router.refresh();
      },
    );
  return (
    <div className="flex flex-col gap-2">
      <BigButton variant={on ? "destructive" : "default"} pending={pending} disabled={!available} onClick={flip}>
        {on ? "Switch off" : "Switch on"}
      </BigButton>
      <ErrorBox error={error} />
    </div>
  );
}

export function TakeOff({ kind, id, who }: { kind: "ABSENCE" | "DUTY"; id: string; who: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <BigButton
        variant="outline"
        pending={pending}
        onClick={() =>
          call(
            () => takeOff(kind, id),
            () => {
              toast.success(`${who}: taken off`);
              router.refresh();
            },
          )
        }
      >
        Take off
      </BigButton>
      <ErrorBox error={error} />
    </div>
  );
}
