/** "SFT A · PLATOON 5": the non-empty parts, each once (COY HQ's camp and platoon share a name). */
export function place(...parts: (string | null | undefined)[]): string {
  return [...new Set(parts.filter((p): p is string => !!p))].join(" · ");
}
