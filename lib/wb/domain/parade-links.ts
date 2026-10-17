import { indexCamps, servingCampId } from "@/lib/parade/compute";
import type { CoySnapshot, Issue } from "@/lib/parade/types";
import { hasGrant, type GrantRow } from "./grants";
import type { WbRole } from "./roles";

// The hop between the Mini App and the v1 web app (agreed with the user
// 2026-10-17): where the Mini App may open v1, where Telegram's Back goes
// inside v1, and which of v1's blocking issues are a commander's. Pure, so the
// client (Back) and the server (sign-in, Home) share it.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** v1's bottom-nav screens: Overview, Platoon, Duties, Parade, History, Admin. */
const V1_TABS = new RegExp(`^/(?:duties|parade|history|admin|s/${UUID})?$`);
/** The v1 screens the Mini App links to. */
const V1_TARGETS = new RegExp(`^/(?:parade|duties|history|c/${UUID}|s/${UUID})?$`);

/** Where "Parade state" may land: one of V1_TARGETS, else the Overview. */
export const paradeStatePath = (to: unknown): string => (typeof to === "string" && V1_TARGETS.test(to) ? to : "/");

/** Telegram's Back inside v1: a tab screen leaves for the Mini App; anything deeper goes back one screen. */
export const v1BackLeaves = (pathname: string): boolean => V1_TABS.test(pathname);

/**
 * How many of v1's blocking issues sit in this member's scope, by the camp or
 * platoon each one is about (an Extra/RF/SOL by the camp it's counted at).
 * An issue about no camp or platoon is company command's.
 */
export function issuesInScope(snapshot: CoySnapshot, issues: readonly Issue[], grants: readonly GrantRow[], roles: readonly WbRole[]): number {
  const idx = indexCamps(snapshot);
  const subunitOf = new Map(snapshot.subunits.flatMap((s) => s.camps.map((c) => [c.id, s.id] as const)));
  const duties = new Map(snapshot.duties.map((d) => [d.id, d]));
  return issues.filter((i) => {
    const t = i.target;
    const duty = t.kind === "duty" ? duties.get(t.dutyId) : undefined;
    const campId = t.kind === "camp" || t.kind === "person" ? t.campId : duty ? servingCampId(duty, idx) : null;
    const subunitId = t.kind === "subunit" ? t.subunitId : campId ? subunitOf.get(campId) : undefined;
    return subunitId ? hasGrant(grants, roles, { subunitId, campId }) : hasGrant(grants, roles, "company");
  }).length;
}
