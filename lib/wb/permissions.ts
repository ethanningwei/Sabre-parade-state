import type { WbRole } from "@/lib/wb/domain/roles";

// Who may use which Phase 1 screen or command. Scope is checked separately.

export const ADMIN_ROLES: readonly WbRole[] = ["ADMIN"];
export const GAPS_ROLES: readonly WbRole[] = ["PS", "PC", "OC", "2IC", "CSM", "ASA", "ADMIN"];
/** /here needs PC or PS of that platoon (or a company-wide grant), or ADMIN. */
export const HERE_ROLES: readonly WbRole[] = ["PC", "PS", "ADMIN"];
/** "Parade state": signs them in to the v1 web app by name. Troopers and ASAs don't get it. */
export const PARADE_STATE_ROLES: readonly WbRole[] = ["GC", "PS", "PC", "OC", "2IC", "CSM", "ADMIN"];

/** Grants an admin can hand out, and the scope each one usually takes. */
export const ROLE_LABELS: Record<WbRole, string> = {
  GC: "Guard comm (a camp)",
  PS: "Platoon sergeant",
  PC: "Platoon commander",
  "2IC": "2IC (company)",
  OC: "OC (company)",
  CSM: "CSM (company)",
  ASA: "ASA (company)",
  ADMIN: "Sabre admin",
};
