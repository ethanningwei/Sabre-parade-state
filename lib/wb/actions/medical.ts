"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { mcCategoryOf, statusLabel } from "@/lib/wb/domain/describe";
import { MC_CATEGORIES, STATUSES } from "@/lib/wb/domain/roles";
import { MAX_STATUSES, NOT_ON_ROSTER } from "@/lib/wb/domain/rules";
import { miniApp, zDate } from "@/lib/wb/input";
import { markOnens, noStatusesToDeclare, saveOutcome } from "@/lib/wb/outcome";
import { verifyPhotoToken } from "@/lib/wb/photo";
import { personWhere } from "@/lib/wb/records";
import { courier } from "@/lib/wb/telegram/courier";

// The Mini App's medical actions: what the doctor gave (outcome, correction,
// nothing given) and "Uploaded to ONENS". Report sick itself is in records.ts
// with the other requests. Every rule lives in lib/wb/domain and lib/wb/outcome.

const statusInput = z.object({
  permanent: z.boolean(),
  type: z.enum([...STATUSES, "OTHER"]),
  other: z.string().trim().max(60).default(""),
  startDate: zDate,
  endDate: zDate.nullable(),
});

const outcomeInput = z.object({
  anchorId: z.string().uuid().nullable(),
  mc: z
    .object({
      kind: z.enum(["MC", "HL"]),
      category: z.enum([...MC_CATEGORIES, "OTHER"], { message: "Say what it was for." }),
      diagnosis: z.string().trim().min(1, "Copy the diagnosis from the paper.").max(200),
      startDate: zDate,
      endDate: zDate,
      seenBy: z.enum(["MO", "CIVILIAN"]).nullable(),
    })
    .nullable(),
  statuses: z.array(statusInput).max(MAX_STATUSES, `${MAX_STATUSES} statuses at a time. Record the rest as a second entry.`),
  /** from /api/wb/photo; null keeps the photo already on the outcome being corrected */
  photoToken: z.string().max(2000).nullable(),
  onensUploaded: z.boolean().default(false),
});

/**
 * What the doctor gave him: an MC or HL, up to four statuses, one photo, and
 * (civilian MC only) whether it's on ONENS. Against an approved RSI/RSO or an
 * MA, standalone, or replacing an earlier answer. Neither MC nor status, on a
 * visit, records "nothing given".
 */
export async function recordOutcome(input: z.input<typeof outcomeInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    if (!member.personId || !(await personWhere(member.personId))) throw new UserError(NOT_ON_ROSTER);
    const a = outcomeInput.parse(input);

    let photoFileId: string | null = null;
    if (a.photoToken) {
      photoFileId = verifyPhotoToken(a.photoToken, member.id);
      if (!photoFileId) throw new UserError("That photo has expired. Add it again.");
    }
    checkStatuses(a.statuses);

    const res = await saveOutcome(await courier(), miniApp(member), {
        anchorId: a.anchorId,
        mc: a.mc ? { ...a.mc, category: mcCategoryOf(a.mc.category) } : null,
        statuses: a.statuses.map(toStatus),
        photoFileId,
        onensUploaded: a.onensUploaded,
      });
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

type StatusIn = z.infer<typeof statusInput>;

function checkStatuses(statuses: readonly StatusIn[]): void {
  for (const [i, st] of statuses.entries()) {
    if (st.type === "OTHER" && !st.other) throw new UserError(`Type status ${i + 1} as it's written on the paper.`);
    if (!st.permanent && !st.endDate) throw new UserError(`Say when status ${i + 1} ends.`);
  }
}

const toStatus = (st: StatusIn) => ({ label: statusLabel(st.type, st.other), startDate: st.startDate, endDate: st.permanent ? null : st.endDate });

const declareInput = z.object({
  statuses: z.array(statusInput).min(1, "Add at least one status.").max(MAX_STATUSES, `${MAX_STATUSES} statuses at a time. Add the rest as a second entry.`),
  photoToken: z.string().max(2000).nullable(),
});

/**
 * Statuses he already had when he joined Sabre (2026-10-27): asked at the end
 * of registration and on Home until he answers. The paper is optional.
 */
export async function declareStatuses(input: z.input<typeof declareInput>) {
  requireFeature();
  return run(async () => {
    const member = await actionMember();
    if (!member.personId || !(await personWhere(member.personId))) throw new UserError(NOT_ON_ROSTER);
    const a = declareInput.parse(input);
    let photoFileId: string | null = null;
    if (a.photoToken) {
      photoFileId = verifyPhotoToken(a.photoToken, member.id);
      if (!photoFileId) throw new UserError("That photo has expired. Add it again.");
    }
    checkStatuses(a.statuses);
    const res = await saveOutcome(await courier(), miniApp(member), {
      anchorId: null,
      mc: null,
      statuses: a.statuses.map(toStatus),
      photoFileId,
      onensUploaded: false,
      declared: true,
    });
    if (!res.ok) throw new UserError(res.error);
    return res.value;
  });
}

/** "None": he has no statuses from before, so Home stops asking. */
export async function noStatuses() {
  requireFeature();
  return run(async () => {
    const res = await noStatusesToDeclare(miniApp(await actionMember()));
    if (!res.ok) throw new UserError(res.error);
    return null;
  });
}

const idInput = z.object({ recordId: z.string().uuid() });

/** "Uploaded to ONENS": the trooper on his own MC, or his PC/PS. */
export async function markUploaded(input: z.input<typeof idInput>) {
  requireFeature();
  return run(async () => {
    const res = await markOnens(await courier(), miniApp(await actionMember()), idInput.parse(input).recordId);
    if (!res.ok) throw new UserError(res.error);
    return { onens: res.value.onens };
  });
}
