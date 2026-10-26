import { cn } from "@/lib/utils";
import { STRENGTH_PARTS, type Strength, type StrengthPart } from "@/lib/status";

export const PART_BG: Record<StrengthPart, string> = {
  present: "bg-present",
  offshift: "bg-offshift",
  leave: "bg-absent",
  medical: "bg-medical",
  others: "bg-others",
};

/** One bar split by part (present, off shift, leave, medical, others), in proportion. */
export function StrengthBar({ strength, className }: { strength: Strength; className?: string }) {
  const shown = STRENGTH_PARTS.filter((k) => strength.parts[k] > 0);
  return (
    <div className={cn("flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      {shown.map((k) => (
        <div key={k} className={cn("h-full transition-[flex-grow] duration-500", PART_BG[k])} style={{ flexGrow: strength.parts[k] }} />
      ))}
    </div>
  );
}
