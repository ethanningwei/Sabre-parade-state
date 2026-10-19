import type { WbRole } from "./roles";

// The grant-scope rule. Pure, so client code and the domain rules can use it.

export interface GrantRow {
  role: WbRole;
  subunitId: string | null;
  campId: string | null;
}

/**
 * What a check is about:
 *   "any"      holding the role anywhere is enough (e.g. seeing Roster)
 *   "company"  only a company-wide grant will do
 *   {subunitId, campId?}  a platoon, or a camp in it: a company-wide grant,
 *              a grant for that platoon, or a grant for that very camp
 */
export type GrantScope = "any" | "company" | { subunitId: string; campId?: string | null };

export function grantCovers(g: GrantRow, roles: readonly WbRole[], scope: GrantScope): boolean {
  if (!roles.includes(g.role)) return false;
  if (scope === "any") return true;
  const companyWide = !g.subunitId && !g.campId;
  if (companyWide) return true;
  if (scope === "company") return false;
  if (g.subunitId) return g.subunitId === scope.subunitId;
  return !!scope.campId && g.campId === scope.campId;
}

export const hasGrant = (grants: readonly GrantRow[], roles: readonly WbRole[], scope: GrantScope) =>
  grants.some((g) => grantCovers(g, roles, scope));
