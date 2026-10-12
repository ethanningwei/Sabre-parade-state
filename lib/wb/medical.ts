import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { wbAudit } from "@/lib/wb/audit";
import { wbRecord } from "@/lib/wb/db/schema";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { canSeeMedical } from "@/lib/wb/domain/rules";
import type { RecordView } from "@/lib/wb/records";

// The only way to read a diagnosis or a document photo's file_id. Each read is
// checked against canSeeMedical (the trooper, his PC/PS, OC/2IC/CSM) and
// written to wb_audit, whether it's a page showing the diagnosis or the file
// route sending the photo. Nothing here is ever sent to a group chat.

export interface Viewer {
  id: string;
  personId: string | null;
  grants: readonly GrantRow[];
}

export type MedicalField = "diagnosis" | "photo";

/**
 * The diagnoses of these records, for a viewer allowed to see them. Records
 * he may not see, or with no diagnosis, are left out. One audit row per
 * diagnosis actually returned.
 */
export async function readDiagnoses(viewer: Viewer, records: readonly RecordView[], via: "MINIAPP" | "BOT"): Promise<Map<string, string>> {
  const allowed = records.filter((r) => canSeeMedical(viewer, r)).map((r) => r.id);
  const out = new Map<string, string>();
  if (!allowed.length) return out;
  const rows = await db.select({ id: wbRecord.id, diagnosis: wbRecord.diagnosis }).from(wbRecord).where(inArray(wbRecord.id, allowed));
  for (const r of rows) if (r.diagnosis) out.set(r.id, r.diagnosis);
  if (out.size) {
    await db.transaction(async (tx) => {
      for (const id of out.keys()) await audit(tx, viewer.id, via, id, "diagnosis");
    });
  }
  return out;
}

/** Which of these records have a photo, without reading the file_id (no audit: nothing is shown). */
export async function photoIds(records: readonly RecordView[]): Promise<Set<string>> {
  if (!records.length) return new Set();
  const rows = await db
    .select({ id: wbRecord.id, f: wbRecord.evidenceFileId })
    .from(wbRecord)
    .where(inArray(wbRecord.id, records.map((r) => r.id)));
  return new Set(rows.filter((r) => r.f).map((r) => r.id));
}

/** The photo's file_id for the file route, if the viewer may see it. Audited. */
export async function readPhoto(viewer: Viewer, r: RecordView): Promise<string | null> {
  if (!canSeeMedical(viewer, r)) return null;
  const [row] = await db.select({ f: wbRecord.evidenceFileId }).from(wbRecord).where(eq(wbRecord.id, r.id));
  if (!row?.f) return null;
  await audit(db, viewer.id, "MINIAPP", r.id, "photo");
  return row.f;
}

type Tx = Parameters<typeof wbAudit>[0];
const audit = (tx: Tx, memberId: string, via: "MINIAPP" | "BOT", recordId: string, field: MedicalField) =>
  wbAudit(tx, { memberId, via, action: "read-medical", entity: "wb_record", entityId: recordId, after: { field } });
