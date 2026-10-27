"use client";

import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { switchBackAction, switchToRotAction } from "@/lib/wb/actions/changeover";
import type { SwitchPreview } from "@/lib/wb/changeover-data";
import { BigButton, ErrorBox, useAction } from "../form-bits";
import { TgSheet } from "../roster/tg-sheet";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Lines({ title, icon, lines }: { title: string; icon: "go" | "keep"; lines: string[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="tg-rows overflow-hidden rounded-2xl bg-card">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm leading-snug">
            {icon === "go" ? <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-present" aria-hidden />}
            {l}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Switch to ROT, behind its confirmation sheet (mockup 7). Locked until every man has a section. */
export function SwitchPanel({ ready, preview }: { ready: boolean; preview: SwitchPreview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, call } = useAction();
  const p = preview;
  return (
    <>
      <BigButton missing={ready ? null : "Every man needs a section first."} onClick={() => setOpen(true)}>
        Switch to ROT
      </BigButton>
      <TgSheet open={open} onOpenChange={setOpen} title="Switch to ROT?" description="The next parade state prints in the ROT format.">
        <Lines
          title="This will"
          icon="go"
          lines={[
            `Move ${plural(p.men, "man", "men")} into their sections`,
            `Take ${plural(p.svc, "SVC trooper")} off the roster, as ORD does`,
            `Switch off the ${plural(p.camps, "guardroom camp")} (kept as history)`,
            `End ${p.extras} Extra/RF/SOL still open`,
            "Hide Shifts, HOTO, and RF and duties",
            `Replace ${plural(p.grantsOut, "GC/PC/PS role")} with ${plural(p.grantsIn, "SC/PC/PS role")}`,
          ]}
        />
        <Lines title="It keeps" icon="keep" lines={["MC, leave and courses already running", "Requests waiting on a PS", "Every record and old parade state"]} />
        <ErrorBox error={error} />
        <div className="grid grid-cols-2 gap-2">
          <BigButton
            pending={pending}
            onClick={() =>
              call(switchToRotAction, (r) => {
                setOpen(false);
                toast.success(`In ROT: ${r.moved} men in ${r.sections} sections, ${r.removed} SVC troopers off the roster.`);
                if (r.kept.length) toast.warning(`Still on the roster: ${r.kept.join("; ")}`);
                router.refresh();
              })
            }
          >
            Switch to ROT
          </BigButton>
          <BigButton variant="secondary" onClick={() => setOpen(false)}>
            Back
          </BigButton>
        </div>
        <p className="text-center text-xs text-muted-foreground">Something wrong? You can switch back to Vigilance the same day.</p>
      </TgSheet>
    </>
  );
}

/** Switch back to Vigilance: undoes the switch from its log. */
export function SwitchBackPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, call } = useAction();
  return (
    <>
      <BigButton variant="outline" onClick={() => setOpen(true)}>
        Switch back to Vigilance
      </BigButton>
      <TgSheet open={open} onOpenChange={setOpen} title="Switch back to Vigilance?" description="Everything the switch did is undone. The draft stays, so you can switch again.">
        <Lines
          title="This will"
          icon="go"
          lines={[
            "Put every man back in his camp, with his role and place on the roster",
            "Bring back the SVC troopers it took off: accounts, MC and leave, Extra/RF/SOL, and requests waiting on a decision",
            "Bring back the Extra/RF/SOL it ended",
            "Give back the GC, PC and PS roles, and end the SC roles",
            "Delete the ROT platoons and sections from the parade state",
          ]}
        />
        <Lines title="It keeps" icon="keep" lines={["Records made during ROT", "Old parade states"]} />
        <ErrorBox error={error} />
        <div className="grid grid-cols-2 gap-2">
          <BigButton
            variant="destructive"
            pending={pending}
            onClick={() =>
              call(switchBackAction, (r) => {
                setOpen(false);
                toast.success(`Back in Vigilance: ${r.moved} men moved back, ${r.restored} SVC troopers back on the roster.`);
                for (const n of r.notes) toast.warning(n);
                router.refresh();
              })
            }
          >
            Switch back
          </BigButton>
          <BigButton variant="secondary" onClick={() => setOpen(false)}>
            Back
          </BigButton>
        </div>
      </TgSheet>
    </>
  );
}
