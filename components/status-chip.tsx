import type { AbsenceType } from "@/lib/parade/types";
import { STATUS_LABEL, STATUS_PART, type StrengthPart } from "@/lib/status";
import { cn } from "@/lib/utils";

type Status = AbsenceType | "PRESENT" | "OFFSHIFT";

// one tint per strength part, as the bars and the dial
const TONE: Record<StrengthPart, string> = {
  present: "bg-present/12 text-present ring-present/25",
  offshift: "bg-offshift/12 text-offshift ring-offshift/25",
  leave: "bg-absent/15 text-absent ring-absent/30",
  medical: "bg-medical/12 text-medical ring-medical/25",
  others: "bg-others/12 text-others ring-others/25",
};
const OVERDUE = "bg-issue/12 text-issue ring-issue/25";

const partOf = (status: Status): StrengthPart =>
  status === "PRESENT" ? "present" : status === "OFFSHIFT" ? "offshift" : STATUS_PART[status];

export function StatusChip({ status, overdue, className }: { status: Status; overdue?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        overdue ? OVERDUE : TONE[partOf(status)],
        className,
      )}
    >
      {overdue ? "Overdue" : status === "OFFSHIFT" ? "Off shift" : STATUS_LABEL[status]}
    </span>
  );
}

/** "TAN WEI JIE" → "TW", "SYAFIQ" → "SY". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** A roster row's initials, tinted by status; overdue gets a red ring. Decorative: the row says the name and status. */
export function StatusAvatar({ name, status, overdue }: { name: string; status: Status; overdue?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tracking-tight",
        overdue ? "bg-issue/12 text-issue ring-2 ring-issue ring-offset-2 ring-offset-card" : TONE[partOf(status)],
      )}
    >
      {initials(name)}
    </span>
  );
}
