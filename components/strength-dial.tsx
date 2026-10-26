import { cn } from "@/lib/utils";
import { PART_LABEL, STRENGTH_PARTS, type Strength, type StrengthPart } from "@/lib/status";
import { CountUp } from "@/components/count-up";

const PART_STROKE: Record<StrengthPart, string> = {
  present: "stroke-present",
  offshift: "stroke-offshift",
  leave: "stroke-absent",
  medical: "stroke-medical",
  others: "stroke-others",
};
const PART_DOT: Record<StrengthPart, string> = {
  present: "bg-present",
  offshift: "bg-offshift",
  leave: "bg-absent",
  medical: "bg-medical",
  others: "bg-others",
};

const R = 52;
const C = 2 * Math.PI * R;

/**
 * Overview's ring: the coy's men split by part, the present strength (Extra/RF/SOL
 * included, as printed) counting up in the middle, and a legend beside it.
 */
export function StrengthDial({ strength, present }: { strength: Strength; present: number }) {
  const shown = STRENGTH_PARTS.filter((k) => strength.parts[k] > 0);
  const gap = shown.length > 1 ? 2 : 0;
  const lengths = shown.map((k) => (strength.total ? (strength.parts[k] / strength.total) * C : 0));
  // each segment starts where the ones before it end
  const segments = shown.map((k, i) => ({
    k,
    dash: Math.max(lengths[i] - gap, 0.5),
    offset: -lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  return (
    <div className="flex items-center gap-5">
      <div className="relative size-33 shrink-0">
        <svg viewBox="0 0 132 132" className="size-full -rotate-90" role="img" aria-label={`${present} of ${strength.total} present`}>
          <circle cx="66" cy="66" r={R} fill="none" strokeWidth="14" className="stroke-muted" />
          {segments.map((s) => (
            <circle
              key={s.k}
              cx="66"
              cy="66"
              r={R}
              fill="none"
              strokeWidth="14"
              strokeDasharray={`${s.dash} ${C}`}
              strokeDashoffset={s.offset}
              className={cn("dial-seg", PART_STROKE[s.k])}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
          <CountUp value={present} className="font-mono text-4xl/none font-semibold tracking-tight tabular-nums" />
          <span className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">of {strength.total}</span>
        </div>
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        {STRENGTH_PARTS.filter((k) => k === "present" || strength.parts[k] > 0).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-[3px]", PART_DOT[k])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{PART_LABEL[k]}</span>
            <span className="font-mono font-semibold tabular-nums">{strength.parts[k]}</span>
          </li>
        ))}
        {strength.duties > 0 && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-[3px] bg-duty" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Extra/RF/SOL</span>
            <span className="font-mono font-semibold text-duty tabular-nums">+{strength.duties}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
