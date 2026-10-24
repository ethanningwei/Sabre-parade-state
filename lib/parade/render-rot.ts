// The ROT parade state: platoons, then their sections (docs/phases-plan.md §2).
//
// PROVISIONAL. There is no real ROT parade state yet (§4 #1): this is the
// confirmed shape, printed with Vigilance's own wording and spacing, and its
// golden text (tests/fixtures/rot-example.txt) is hand-written. Replace both
// once the real one arrives.
//
// The shape: Vigilance's header, CAA line and strength summary; COY HQ as
// today; per platoon "• Total strength / • Present strength"; then each
// section's strength block and numbered absentees. No Platoon HQ block, no
// Off Shift, no RF. Vigilance's renderParadeState (render.ts) is untouched.
//
// Every camp of a platoon is a section here. The snapshot it's given is the
// ROT one (lib/wb/domain/rot.ts rotSnapshot): sections relabelled
// "SECTION 1", no Extra/RF/SOL.

import { computeCoy, type CampState, type SubunitState } from "./compute";
import { absenteeLine, pad0, SECTION_SEPARATOR } from "./render";
import { ddmmyy, type SgtParts } from "./time";
import type { CoySnapshot } from "./types";

type Print = (s?: string) => void;

function absentees(p: Print, c: CampState) {
  p(`• Absentees (MC, AL, etc): ${pad0(c.absentees.length)}`);
  if (c.absentees.length) p();
  c.absentees.forEach((person, i) => {
    p(absenteeLine(i + 1, person));
    if (i + 1 < c.absentees.length) p();
  });
}

/** COY HQ, as Vigilance prints it. */
function renderHq(p: Print, name: string, c: CampState) {
  p(name);
  p(`• Total Strength: ${pad0(c.total)}`);
  if (!c.onShift) {
    p(`• Present Strength: 00`);
    p(`• Off Shift: ${pad0(c.total)}`);
    return;
  }
  p(`• Present Strength: ${pad0(c.present)}`);
  p();
  absentees(p, c);
}

function renderSection(p: Print, c: CampState) {
  p(c.camp.name);
  p(`• Total Strength: ${pad0(c.total)}`);
  p(`• Present Strength: ${pad0(c.present)}`);
  p();
  absentees(p, c);
}

function renderPlatoon(p: Print, s: SubunitState) {
  p(s.subunit.name);
  p(`• Total strength: ${s.total}`);
  p(`• Present strength: ${s.present}`);
  p();
  s.camps.forEach((c, i) => {
    renderSection(p, c);
    if (i + 1 < s.camps.length) p();
  });
}

/** Render the ROT parade state. Only call once validate() returned no issues. */
export function renderRotParadeState(snapshot: CoySnapshot, caa: SgtParts): string {
  const state = computeCoy(snapshot);
  const out: string[] = [];
  const p: Print = (s = "") => void out.push(s + "\n");
  out.push(`${snapshot.coy.displayName} Parade State\n\n`);
  out.push(`CAA: ${ddmmyy(caa.date)} ${caa.time}H\n\n`);
  out.push(`Total Strength: ${pad0(state.present)}/${pad0(state.total)}\n`);
  for (const s of state.subunits) out.push(`${s.subunit.name}: ${pad0(s.present)}/${pad0(s.total)}\n`);
  for (const s of state.subunits) {
    out.push(`${SECTION_SEPARATOR} \n\n`);
    if (s.subunit.isHq) renderHq(p, s.subunit.name, s.camps[0]);
    else renderPlatoon(p, s);
  }
  return out.join("");
}
