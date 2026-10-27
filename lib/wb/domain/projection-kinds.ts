// Vocabularies for wb_projection, kept apart from the schema so client code
// can use them without pulling in Drizzle.

export const WB_PROJECTION_KINDS = ["ABSENCE", "DUTY", "SHIFT"] as const;
export type WbProjectionKind = (typeof WB_PROJECTION_KINDS)[number];

/**
 * How the projector stopped owning a v1 row:
 * VOID      the record was voided, withdrawn, rejected or cancelled, or moved off today
 * BACK      it ended and a commander confirmed "Back"
 * REPLACED  another record took over the man's one open absence
 * STOOD_DOWN the assignment was stood down
 * BY_HAND   a GC closed or changed it in the web app: never reopened for the same record
 * DONE      a SHIFT that was applied (or superseded by a later HOTO), or a stay-out night over at 0600
 */
export const WB_PROJECTION_CLOSES = ["VOID", "BACK", "REPLACED", "STOOD_DOWN", "BY_HAND", "DONE"] as const;
export type WbProjectionClose = (typeof WB_PROJECTION_CLOSES)[number];

/** "✅ Back" on the evening "Back?" message: b:<projectionId>. */
export const BACK_CALLBACK = /^b:([0-9a-f-]{36})$/;
export const backData = (projectionId: string) => `b:${projectionId}`;

/** The evening "🏠 Stay-out tonight": y:<subunitId>:<night>:ok (✅ Correct) or y:<personId>:<night>:in (staying in, and back). */
export const STAYOUT_CALLBACK = /^y:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(ok|in)$/;
export const stayoutData = (id: string, night: string, act: "ok" | "in") => `y:${id}:${night}:${act}`;
