"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import * as conducts from "@/lib/wb/conducts";
import { conductInput } from "@/lib/wb/domain/conducts";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { miniApp, zId } from "@/lib/wb/input";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's conducts (slice 2 of docs/conducts-plan.md, FEATURE_CONDUCTS).
// Rules are in lib/wb/conducts.ts and lib/wb/domain/conducts.ts; this checks input.

const zTap = z.union([z.object({ going: z.literal(true) }), z.object({ going: z.literal(false), reason: z.string().trim().min(1, "Say why").max(60) })]);
const reportInput = z.object({ conductCampId: zId, taps: z.record(z.uuid(), zTap) });

export async function setUpConduct(input: z.input<ReturnType<typeof conductInput>>) {
  requireFeature();
  requireFeature("CONDUCTS");
  return run(async () => {
    const res = await conducts.setUpConduct(await courier(), miniApp(await actionMember()), conductInput(todaySgt()).parse(input));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

export async function sendStrength(input: z.input<typeof reportInput>) {
  requireFeature();
  requireFeature("CONDUCTS");
  return run(async () => {
    const res = await conducts.reportConductStrength(await courier(), miniApp(await actionMember()), reportInput.parse(input));
    if (!res.ok) throw new UserError(res.error);
    return { delivery: res.value.delivery, text: res.value.text, again: res.value.again };
  });
}

export async function nudgeCamp(conductCampId: string) {
  requireFeature();
  requireFeature("CONDUCTS");
  return run(async () => {
    const res = await conducts.nudgeConductCamp(await courier(), miniApp(await actionMember()), zId.parse(conductCampId));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

export async function cancelConduct(conductId: string) {
  requireFeature();
  requireFeature("CONDUCTS");
  return run(async () => {
    const res = await conducts.cancelConduct(await courier(), miniApp(await actionMember()), zId.parse(conductId));
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}
