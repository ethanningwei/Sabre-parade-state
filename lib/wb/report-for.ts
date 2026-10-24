import "server-only";
import type { Member } from "@/lib/wb/auth";
import { reportAccess, screens } from "@/lib/wb/domain/access";
import { dayRange, todaySgt } from "@/lib/wb/domain/timeline";
import { peopleInScope, personWhere, reportedFor, rolesOfPerson, type ScopedPerson } from "@/lib/wb/records";

// Report for your men (2026-10-24), for the sick and MA pages: who a report
// is for, the man picker, and on a man's own form the days already reported
// for him. The core (lib/wb/decide submit) checks all of it again.

/** Who a form is for, when it isn't the member himself. */
export interface ForMan {
  personId: string;
  /** "PTE TAN" */
  who: string;
  /** the reporter could approve it himself, so a report sick is saved approved */
  approvesOnSave: boolean;
}

/** A report made for him, as his own form sees it: which day, and who. */
export interface ReportedItem {
  id: string;
  kind: "RSI" | "RSO" | "MA";
  date: string;
  by: string;
}

/** Whether the member reports for anyone at all: the Apply hub's "For one of my men", and the pages' picker. */
export const reportsForMen = (member: Member) => screens(member).add;

/** The men he may report for, never himself. */
export async function menToReportFor(member: Member): Promise<ScopedPerson[]> {
  return (await peopleInScope(member.grants, "proxy")).filter((p) => p.personId !== member.personId);
}

/** The man a ?for=<id> names, if the member may report for him. */
export async function forManOf(member: Member, personId: string): Promise<ForMan | null> {
  if (!/^[0-9a-f-]{36}$/.test(personId)) return null;
  const p = await personWhere(personId);
  if (!p) return null;
  const can = reportAccess(member, { ...p, ownerRoles: await rolesOfPerson(personId) });
  return can.reports ? { personId, who: `${p.rank} ${p.name}`, approvesOnSave: can.approvesOnSave } : null;
}

/** Reports made for him from today on, for his own sick and MA forms. */
export async function reportedItems(personId: string, today = todaySgt()): Promise<ReportedItem[]> {
  const rows = await reportedFor(personId, dayRange(today).startAt);
  return rows.map((r) => ({ id: r.id, kind: r.kind as ReportedItem["kind"], date: todaySgt(r.startAt), by: r.reporterLabel ?? "Your commander" }));
}
