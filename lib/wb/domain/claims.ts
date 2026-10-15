import { toSgt } from "../../parade/time";
import { addDays, dayMonth } from "./timeline";

// Transport claims (Phase 7). Pure: no I/O. Ports Sabre Bot's flows.py
// (CLAIM, claim_days, _place), config.py (CAMP_ADDRESS, address_of,
// VEHICLE_TYPES, CLAIM_HEADERS) and store.py (Claims, slash).
//
// The OC decides in his own Google Sheet, as he did with the Form SG (the
// user, 2026-10-15): the Mini App only replaces the form. A claim is one row
// per day, appended to the sheet; his verdict is read back once a day and the
// trooper is told. Nothing about a claim is approved in Telegram.

/** Four buttons, never a text box: the sheet's column is read at a glance. */
export const VEHICLE_TYPES = ["PRIVATE HIRE VEHICLE", "TAXI", "BUS", "MRT"] as const;
export type Vehicle = (typeof VEHICLE_TYPES)[number];

/**
 * PENDING until the OC's verdict is read back from the sheet. REMOVED: the row
 * is gone from every tab (CONFIRM DELETE), so the Mini App stops showing it.
 */
export const WB_CLAIM_STATES = ["PENDING", "APPROVED", "REJECTED", "REMOVED"] as const;
export type WbClaimState = (typeof WB_CLAIM_STATES)[number];

/** The same trip on more days: the fortnight after the first. Further out, he submits again. */
export const MORE_DAYS = 14;
export const MAX_REASON = 120;
export const MAX_PLACE = 80;

/**
 * The office address a man claims to or from, by camp. A 24/7 camp has an A
 * and a B team but one address, so the team drops off. These are the spellings
 * already in the sheet, so the OC can scan the column.
 */
export const CAMP_ADDRESS: Record<string, string> = {
  "COY HQ": "CLEMENTI CAMP",
  CLEMENTI: "CLEMENTI CAMP",
  SFT: "SFT", // Singapore Ferry Terminal
  TFT: "TFT", // Tekong Ferry Terminal
  HDN: "HENDON CAMP",
  SLR: "SELARANG CAMP",
  SRF: "SELARANG CAMP", // the sector response force sits inside it
  BDK: "BEDOK CAMP",
  OSU: "OSU", // Open Source Unit
  PYAD: "PYAD", // Paya Lebar Ammo Depot
  PRC: "PASIR RIS CAMP",
};

/** Where a man claiming transport says his office is: "SRF A" → SELARANG CAMP. */
export function officeAddress(campName: string): string {
  const name = campName.trim().toUpperCase().replace(/\s+/g, " ");
  const base = / [AB]$/.test(name) ? name.slice(0, -2) : name;
  return CAMP_ADDRESS[base] ?? base;
}

/** Start or end: home (no address: the OC isn't going there), his office, or somewhere typed. */
export type Place = { kind: "HOME" } | { kind: "OFFICE" } | { kind: "OTHER"; text: string };

export function placeText(p: Place, office: string): string {
  if (p.kind === "HOME") return "HOME";
  if (p.kind === "OFFICE") return office;
  return p.text.trim().toUpperCase().replace(/\s+/g, " ");
}

/** The days he may tick after naming the first: the fortnight after it. */
export const claimDays = (first: string): string[] => Array.from({ length: MORE_DAYS }, (_, i) => addDays(first, i + 1));

/**
 * The days one request covers: the first plus those ticked, deduplicated and
 * sorted. Null if any is in the past (a claim is approved before the trip;
 * today still counts) or outside the fortnight.
 */
export function claimDates(first: string, also: readonly string[], today: string): string[] | null {
  if (first < today) return null;
  const allowed = new Set(claimDays(first));
  if (also.some((d) => !allowed.has(d))) return null;
  return [...new Set([first, ...also])].sort();
}

// ------------------------------------------------------------------ the sheet

/** The OC's sheet, in its own order. Written by header name, so the order may change there. */
export const CLAIM_HEADERS = [
  "OC APPROVAL",
  "OC REMARKS",
  "DELETE",
  "RANK",
  "NAME",
  "PLATOON",
  "VEHICLE TYPE",
  "DATE OF TRANSPORT",
  "START LOCATION",
  "END LOCATION",
  "REASON",
  "ROUND TRIP",
  "DATE OF REQUEST",
] as const;

/** His verdict, his remarks, and the delete dropdown a PS uses: never written to, not even with a blank. */
export const OWNED_BY_SHEET = ["OC APPROVAL", "OC REMARKS", "DELETE"] as const;

/** YYYY-MM-DD → DD/MM/YYYY, the shape two years of the sheet already hold. */
export const slashDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** When he asked, in SGT, as the sheet's DATE OF REQUEST: "14/10/2026 14:21". */
export function requestStamp(at: Date): string {
  const { date, time } = toSgt(at);
  return `${slashDate(date)} ${time.slice(0, 2)}:${time.slice(2)}`;
}

export interface ClaimRow {
  rank: string;
  name: string;
  platoon: string;
  vehicle: string;
  tripDate: string;
  startPlace: string;
  endPlace: string;
  reason: string;
  roundTrip: boolean;
  /** DATE OF REQUEST, from requestStamp() */
  requested: string;
}

/** One claim as the sheet holds it, by header. Only the columns Sabre owns. */
export function sheetRow(c: ClaimRow): Record<string, string> {
  return {
    RANK: c.rank,
    NAME: c.name,
    PLATOON: c.platoon,
    "VEHICLE TYPE": c.vehicle,
    "DATE OF TRANSPORT": slashDate(c.tripDate),
    "START LOCATION": c.startPlace,
    "END LOCATION": c.endPlace,
    REASON: c.reason,
    "ROUND TRIP": c.roundTrip ? "YES" : "NO",
    "DATE OF REQUEST": c.requested,
  };
}

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

/** Header name → column index. Throws if a column Sabre writes is missing. */
export function headerIndex(header: readonly unknown[], need: readonly string[] = Object.keys(sheetRow(EXAMPLE))): Map<string, number> {
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = norm(h);
    if (k && !idx.has(k)) idx.set(k, i);
  });
  if (!idx.size) throw new Error("The claim sheet has no header row.");
  const missing = need.filter((c) => !idx.has(c));
  if (missing.length) throw new Error(`The claim sheet has no ${missing.join(", ")} column.`);
  return idx;
}

const EXAMPLE: ClaimRow = { rank: "", name: "", platoon: "", vehicle: "", tripDate: "2026-01-01", startPlace: "", endPlace: "", reason: "", roundTrip: false, requested: "" };

/**
 * Where one claim goes in a row: the span from the first column Sabre fills to
 * the last, so the OC's columns in front of it are never written (Sabre Bot's
 * Claims._write). A column of his inside the span would be blanked, so that's
 * refused.
 */
export function rowSpan(idx: Map<string, number>, row: Record<string, string>): { first: number; values: string[] } {
  const at = new Map<number, string>();
  for (const [col, val] of Object.entries(row)) {
    const i = idx.get(col);
    if (i === undefined) throw new Error(`The claim sheet has no ${col} column.`);
    at.set(i, val);
  }
  const first = Math.min(...at.keys());
  const last = Math.max(...at.keys());
  for (const owned of OWNED_BY_SHEET) {
    const i = idx.get(owned);
    if (i !== undefined && i > first && i < last) throw new Error(`The ${owned} column sits between Sabre's columns on the claim sheet.`);
  }
  return { first, values: Array.from({ length: last - first + 1 }, (_, i) => at.get(first + i) ?? "") };
}

/** A1 column letters for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ------------------------------------------------------------------ reading verdicts back

/** "5/9/2026 9:05" → "05/09/2026 09:05": a row moved by a script may come back without the zeros. */
function normStamp(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(norm(s));
  if (!m) return norm(s);
  const pad = (x: string) => x.padStart(2, "0");
  return `${pad(m[1])}/${pad(m[2])}/${m[3]}${m[4] ? ` ${pad(m[4])}:${m[5]}` : ""}`;
}

/** What identifies a row the OC may have moved between tabs: whose, which day, asked when. */
export const claimKey = (name: string, tripDate: string, requested: string) => `${norm(name)}|${normStamp(tripDate)}|${normStamp(requested)}`;

export interface Verdict {
  state: "APPROVED" | "REJECTED";
  remarks: string;
}

/**
 * Every row in every tab, by key. A row may have moved from Pending Requests
 * to Processed or Archived, so the row number is no use; the key is. Rows the
 * OC hasn't decided read as null. Two identical keys queue in order.
 */
export function verdictsByKey(tabs: readonly (readonly (readonly unknown[])[])[]): Map<string, (Verdict | null)[]> {
  const out = new Map<string, (Verdict | null)[]>();
  for (const rows of tabs) {
    if (!rows.length) continue;
    let idx: Map<string, number>;
    try {
      idx = headerIndex(rows[0], ["NAME", "DATE OF TRANSPORT", "DATE OF REQUEST", "OC APPROVAL"]);
    } catch {
      continue; // a tab that isn't a claims tab
    }
    const col = (r: readonly unknown[], name: string) => r[idx.get(name)!];
    for (const r of rows.slice(1)) {
      const key = claimKey(String(col(r, "NAME") ?? ""), String(col(r, "DATE OF TRANSPORT") ?? ""), String(col(r, "DATE OF REQUEST") ?? ""));
      if (key === "||") continue;
      const verdict = norm(col(r, "OC APPROVAL"));
      const remarks = idx.has("OC REMARKS") ? String(col(r, "OC REMARKS") ?? "").trim() : "";
      const v: Verdict | null = verdict === "APPROVED" || verdict === "REJECTED" ? { state: verdict, remarks } : null;
      out.set(key, [...(out.get(key) ?? []), v]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ words

export function roundLabel(roundTrip: boolean) {
  return roundTrip ? " (round trip)" : "";
}

/** "on 19/10" or "on 3 days: 19/10, 20/10, 21/10" */
export function daysLabel(dates: readonly string[]): string {
  return dates.length === 1 ? `on ${dayMonth(dates[0])}` : `on ${dates.length} days: ${dates.map(dayMonth).join(", ")}`;
}

export interface ClaimLine {
  vehicle: string;
  tripDate: string;
  startPlace: string;
  endPlace: string;
  reason: string;
  roundTrip: boolean;
}

/** One line per claim: "TAXI 19/10 · HOME → SELARANG CAMP (round trip) · CT SCAN" */
export const claimLine = (c: ClaimLine) => `${c.vehicle} ${dayMonth(c.tripDate)} · ${c.startPlace} → ${c.endPlace}${roundLabel(c.roundTrip)} · ${c.reason}`;

const VERDICT_HEAD = {
  APPROVED: "✅ Transport claim approved",
  REJECTED: "❌ Transport claim rejected",
};

/** The trooper's DM once the OC has decided. */
export function verdictText(rows: readonly (ClaimLine & { state: WbClaimState; remarks: string })[]): string {
  const parts: string[] = [];
  for (const state of ["APPROVED", "REJECTED"] as const) {
    const these = rows.filter((r) => r.state === state);
    if (!these.length) continue;
    const lines = these.map((r) => `• ${claimLine(r)}${r.remarks ? `\n  OC: ${r.remarks}` : ""}`);
    parts.push(`${VERDICT_HEAD[state]}${these.length > 1 ? ` (${these.length})` : ""}\n\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}
