import "server-only";
import { isEnabled } from "@/lib/flags";
import { renderParadeState, type CoySnapshot, type SgtParts } from "@/lib/parade";
import { renderRotParadeState } from "@/lib/parade/render-rot";
import { rotSnapshot, type Phase } from "@/lib/wb/domain/rot";
import { phaseState } from "@/lib/wb/phase";

// v1's parade state by phase (the approved v1 edit, 2026-10-24): in ROT the
// snapshot leaves out the Vigilance camps and prints by platoon and section.
// With FEATURE_WHEREABOUTS off this is v1 exactly: no query, the snapshot as
// loaded, Vigilance's renderer.

export interface ParadeView {
  phase: Phase;
  snapshot: CoySnapshot;
  render(caa: SgtParts): string;
}

export async function paradeView(coyId: string, snapshot: CoySnapshot): Promise<ParadeView> {
  if (!isEnabled("WHEREABOUTS")) return vigilance(snapshot);
  const s = await phaseState(coyId);
  if (s.phase !== "ROT") return vigilance(snapshot);
  const rot = rotSnapshot(snapshot, s.changeover?.log.hiddenCamps ?? []);
  return { phase: "ROT", snapshot: rot, render: (caa) => renderRotParadeState(rot, caa) };
}

function vigilance(snapshot: CoySnapshot): ParadeView {
  return { phase: "VIGILANCE", snapshot, render: (caa) => renderParadeState(snapshot, caa) };
}
