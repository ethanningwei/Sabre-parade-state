import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { wbChangeover, wbPhase } from "@/lib/wb/db/schema";
import type { ChangeoverLog, Phase } from "@/lib/wb/domain/rot";
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
