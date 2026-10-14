// How setStatus turns a status into the absence row's fields. Pure (no DB), so
// the whereabouts projector can tell whether a v1 row already says what it
// would write.

import type { AbsenceType } from "@/lib/parade/types";

export interface StatusFieldsInput {
  status: "PRESENT" | AbsenceType;
  otherReason: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  maTiming: string;
  maLocation: string;
}

/** The absence row's fields for a status (null for PRESENT), exactly as setStatus writes them. */
export function statusFields(input: StatusFieldsInput) {
  const { status } = input;
  if (status === "PRESENT") return null;
  return {
    type: status,
    otherReason: status === "OTHERS" ? input.otherReason.trim() : "",
    startDate: input.startDate,
    startTime: input.startDate ? input.startTime : null,
    endDate: status === "MA" ? null : input.endDate,
    endTime: status === "MA" || !input.endDate ? null : input.endTime,
    maTiming: status === "MA" ? input.maTiming.trim() : "",
    maLocation: status === "MA" ? input.maLocation.trim() : "",
  };
}

export type AbsenceFields = NonNullable<ReturnType<typeof statusFields>>;
