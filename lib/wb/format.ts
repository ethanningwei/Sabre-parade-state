import { sectionLabel } from "@/lib/wb/domain/rot";
/**
 * "SFT A · PLATOON 5": the non-empty parts, each once (COY HQ's camp and
 * platoon share a name). In ROT a section's camp drops its platoon's name:
 * "SECTION 1 · PLATOON 1", not "PLATOON 1 SECTION 1 · PLATOON 1".
 */
export function place(...parts: (string | null | undefined)[]): string {
  const ps = [...new Set(parts.filter((p): p is string => !!p))];
  return ps.map((p, i) => ps.slice(i + 1).reduce((x, later) => sectionLabel(x, later), p)).join(" · ");
}
