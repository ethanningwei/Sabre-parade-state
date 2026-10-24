"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { ForbiddenError } from "@/lib/authz";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { addPlatoon, addSection, assignPasted, placeCamp, placeMen, removePlatoon, removeSection, setCommander, unplaceMen } from "@/lib/wb/changeover";
import { checkPaste, loadDraft, runsChangeover } from "@/lib/wb/changeover-data";
import { miniApp, zId } from "@/lib/wb/input";

// The changeover's draft in the Mini App (/tg/changeover). The rules are in
// lib/wb/changeover.ts; each write checks COY HQ or admin and the phase again.

const unwrap = <T,>(res: { ok: true; value: T } | { ok: false; error: string }) => {
  if (!res.ok) throw new UserError(res.error);
  return res.value;
};
const acting = async () => miniApp(await actionMember());
const ids = z.array(zId).max(400);
const name = z.string().max(60);

export async function addPlatoonAction(raw: string) {
  requireFeature();
  return run(async () => unwrap(await addPlatoon(await acting(), name.parse(raw))));
}

export async function removePlatoonAction(platoonId: string) {
  requireFeature();
  return run(async () => unwrap(await removePlatoon(await acting(), zId.parse(platoonId))));
}

export async function addSectionAction(platoonId: string) {
  requireFeature();
  return run(async () => unwrap(await addSection(await acting(), zId.parse(platoonId))));
}

export async function removeSectionAction(sectionId: string) {
  requireFeature();
  return run(async () => unwrap(await removeSection(await acting(), zId.parse(sectionId))));
}

const commanderInput = z.object({ role: z.enum(["SC", "PC", "PS"]), scopeId: zId, personId: zId.nullable(), remove: z.boolean().optional() });

export async function setCommanderAction(raw: z.input<typeof commanderInput>) {
  requireFeature();
  return run(async () => unwrap(await setCommander(await acting(), commanderInput.parse(raw))));
}

export async function placeMenAction(personIds: string[], sectionId: string) {
  requireFeature();
  return run(async () => unwrap(await placeMen(await acting(), ids.parse(personIds), zId.parse(sectionId))));
}

export async function placeCampAction(campId: string, sectionId: string) {
  requireFeature();
  return run(async () => unwrap(await placeCamp(await acting(), zId.parse(campId), zId.parse(sectionId))));
}

export async function unplaceMenAction(personIds: string[]) {
  requireFeature();
  return run(async () => unwrap(await unplaceMen(await acting(), ids.parse(personIds))));
}

/** Read a pasted list. Saves nothing. */
export async function checkPasteAction(text: string) {
  requireFeature();
  return run(async () => {
    const m = await actionMember();
    if (!(await runsChangeover(m))) throw new ForbiddenError("Only COY HQ and admins can work on the changeover.");
    return checkPaste(await loadDraft(), z.string().max(30000, "That's too long for one paste. Paste it in parts.").parse(text));
  });
}

const pastedInput = z.array(z.object({ personId: zId, platoon: name, section: name, sc: z.boolean() })).max(400);

export async function assignPastedAction(rows: z.input<typeof pastedInput>) {
  requireFeature();
  return run(async () => unwrap(await assignPasted(await acting(), pastedInput.parse(rows))));
}
