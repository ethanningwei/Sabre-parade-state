import { ClipboardCheck, ClipboardX } from "lucide-react";
import type { ParadeStatus } from "@/lib/wb/projection";

// Whether a record has reached the parade state (projection on). An icon and
// words, so it never rests on colour alone. Server-rendered.

export function ParadeStatusLine({ s, compact = false }: { s: ParadeStatus; compact?: boolean }) {
  const Icon = s.on ? ClipboardCheck : ClipboardX;
  const text = s.on ? `On the parade state${s.note ? ` (${s.note})` : ""}` : `Not on the parade state: ${s.why}`;
  return (
    <span
      className={`inline-flex items-center gap-1 ${compact ? "text-xs" : "text-sm"} ${s.on ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
    >
      <Icon className={compact ? "size-3" : "size-4"} aria-hidden />
      {text}
    </span>
  );
}
