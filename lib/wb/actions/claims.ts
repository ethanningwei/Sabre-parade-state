"use server";

import { z } from "zod";
import { run, UserError } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { submitClaim } from "@/lib/wb/claims";
import { MAX_PLACE, MAX_REASON, VEHICLE_TYPES } from "@/lib/wb/domain/claims";
import { claimSheet, claimSheetUrl } from "@/lib/wb/sheets";

// The Mini App's transport claim (Phase 7, FEATURE_CLAIMS). Rules are in
// lib/wb/claims.ts and lib/wb/domain/claims.ts; this checks input.

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const zPlace = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("HOME") }),
  z.object({ kind: z.literal("OFFICE") }),
  z.object({ kind: z.literal("OTHER"), text: z.string().trim().min(2, "Type where.").max(MAX_PLACE) }),
]);

const claimInput = z.object({
  vehicle: z.enum(VEHICLE_TYPES, "Pick how you'll travel."),
  first: zDate,
  also: z.array(zDate).max(14),
  start: zPlace,
  end: zPlace,
  reason: z.string().trim().min(2, "Say what it's for, e.g. CT SCAN.").max(MAX_REASON),
  roundTrip: z.boolean(),
});

export async function sendClaim(input: z.input<typeof claimInput>) {
  requireFeature();
  requireFeature("CLAIMS");
  return run(async () => {
    const member = await actionMember();
    if (!member.registeredAt) throw new UserError("Register first.");
    const a = claimInput.parse(input);
    const res = await submitClaim(claimSheet(), member, a, "MINIAPP");
    if (!res.ok) throw new UserError(res.error);
    return { days: res.value.rows.map((r) => r.tripDate), sheet: res.value.sheet, url: claimSheetUrl() };
  });
}
