import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { coy as coyTable } from "@/lib/db/schema";
import { wbChangeover, wbPhase } from "@/lib/wb/db/schema";
import { ROLES_SECTION, type ChangeoverLog, type Phase } from "@/lib/wb/domain/rot";
import { rolesFor } from "@/lib/wb/domain/roles";
import type { Db } from "@/lib/wb/records";

// Which phase a company is in (Ops Vigilance or ROT), and the switch that put
// it there. No wb_phase row is Vigilance. Callers outside lib/wb that run
// with FEATURE_WHEREABOUTS off must ask isEnabled first (lib/wb/rot-parade.ts
// does): this always reads.

export interface PhaseState {
  phase: Phase;
  /** the Switch to ROT now in force; null in Vigilance */
  changeover: { id: string; switchedAt: Date; log: ChangeoverLog } | null;
}

export async function phaseState(coyId: string, tx: Db = db): Promise<PhaseState> {
  const [row] = await tx
    .select({ phase: wbPhase.phase, id: wbChangeover.id, switchedAt: wbChangeover.switchedAt, log: wbChangeover.log })
    .from(wbPhase)
    .leftJoin(wbChangeover, eq(wbChangeover.id, wbPhase.changeoverId))
    .where(eq(wbPhase.coyId, coyId));
  if (!row || row.phase === "VIGILANCE") return { phase: "VIGILANCE", changeover: null };
  return { phase: row.phase, changeover: row.id ? { id: row.id, switchedAt: row.switchedAt!, log: row.log! } : null };
}

export async function phaseOf(coyId: string, tx: Db = db): Promise<Phase> {
  return (await phaseState(coyId, tx)).phase;
}

/** The company's phase as screens need it: the camps the switch hid (none in Vigilance). Vigilance if there's no coy yet. */
export async function currentPhase(tx: Db = db): Promise<PhaseState & { hidden: ReadonlySet<string> }> {
  const [coy] = await tx.select({ id: coyTable.id }).from(coyTable).orderBy(asc(coyTable.key)).limit(1);
  const s = coy ? await phaseState(coy.id, tx) : { phase: "VIGILANCE" as const, changeover: null };
  return { ...s, hidden: new Set(s.phase === "ROT" ? (s.changeover?.log.hiddenCamps ?? []) : []) };
}

/**
 * The roles a man can hold in a camp: in ROT a section's SC or CBT (mockup
 * 10), otherwise the guardroom's or COY HQ's (rolesFor). A camp the switch
 * hid takes nobody.
 */
export async function rolesForCamp(campId: string, isHq: boolean, tx: Db = db): Promise<readonly string[]> {
  if (isHq) return rolesFor(true);
  const p = await currentPhase(tx);
  if (p.phase !== "ROT") return rolesFor(false);
  return p.hidden.has(campId) ? [] : ROLES_SECTION;
}
