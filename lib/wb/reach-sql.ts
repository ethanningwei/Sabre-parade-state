import { inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Reach } from "@/lib/wb/domain/access";

/**
 * A Reach as a WHERE clause, so a list filtered in SQL agrees with inReach:
 * the whole company is no filter at all, nothing is FALSE, and otherwise a
 * row is in when its platoon or its camp is listed. Columns may be nullable,
 * as inReach's arguments are.
 */
export function reachWhere(reach: Reach, at: { subunitId: AnyColumn; campId: AnyColumn }): SQL | undefined {
  if (reach === "company") return undefined;
  const parts = [
    reach.subunitIds.length ? inArray(at.subunitId, [...reach.subunitIds]) : undefined,
    reach.campIds.length ? inArray(at.campId, [...reach.campIds]) : undefined,
  ].filter((x): x is SQL => !!x);
  return parts.length ? or(...parts) : sql`false`;
}
