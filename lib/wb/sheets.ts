import "server-only";
import { createSign } from "node:crypto";
import { columnLetter, headerIndex, rowSpan, verdictsByKey, type Verdict } from "@/lib/wb/domain/claims";

// The OC's transport claim sheet (Phase 7). He works in it directly, as he
// did when a Form SG filled it: he sets OC APPROVAL, a PS strikes a wrong
// entry with DELETE, and his own script moves decided rows to other tabs.
// So Sabre appends a row and never writes to a cell a person owns, and reads
// his verdicts back by what the row says, not where it is.
//
// A Google service account, free, over plain fetch: no SDK. Configured by
//   WB_GOOGLE_SERVICE_ACCOUNT  the service account's JSON key, whole
//   WB_CLAIMS_SHEET_ID         the spreadsheet (shared with the account as an editor)
//   WB_CLAIMS_TAB              where new rows go (default "Pending Requests")
//   WB_CLAIMS_SHEET_URL        the link troopers are given (default: the sheet)
// Without the first two, claims still save and the Mini App says the sheet isn't wired up.

/** A spreadsheet, reduced to what the claims need. The Google one, or one in memory for tests. */
export interface SheetBackend {
  tabTitles(): Promise<string[]>;
  /** Each tab's rows, as displayed, trailing blanks trimmed. */
  read(tabs: readonly string[]): Promise<string[][][]>;
  /** Write values starting at (row, firstCol), both 1-based. */
  write(updates: readonly { tab: string; row: number; firstCol: number; values: readonly string[] }[]): Promise<void>;
}

export class ClaimSheet {
  constructor(
    private readonly b: SheetBackend,
    readonly tab: string,
  ) {}

  /**
   * Several claims at once, one row each. The tab is read once and the rows
   * written below the last one there, by header name, starting at the first
   * column Sabre fills (an append can't be told to leave the OC's columns
   * alone). Returns the row numbers written.
   */
  async add(rows: readonly Record<string, string>[]): Promise<number[]> {
    if (!rows.length) return [];
    const [values] = await this.b.read([this.tab]);
    if (!values?.length) throw new Error(`The claim sheet has no header row on "${this.tab}".`);
    const idx = headerIndex(values[0]);
    const at = values.length + 1;
    const updates = rows.map((r, n) => {
      const { first, values: span } = rowSpan(idx, r);
      return { tab: this.tab, row: at + n, firstCol: first + 1, values: span };
    });
    await this.b.write(updates);
    return updates.map((u) => u.row);
  }

  /** Every row in every tab by key (see claimKey): the OC's verdict, or null while he hasn't given one. */
  async verdicts(): Promise<Map<string, (Verdict | null)[]>> {
    const titles = await this.b.tabTitles();
    return verdictsByKey(await this.b.read(titles));
  }
}

/** The configured sheet, or null if it isn't wired up. */
export function claimSheet(): ClaimSheet | null {
  const id = process.env.WB_CLAIMS_SHEET_ID;
  const key = process.env.WB_GOOGLE_SERVICE_ACCOUNT;
  if (!id || !key) return null;
  return new ClaimSheet(googleSheet(id, key), process.env.WB_CLAIMS_TAB || "Pending Requests");
}

/** Where a trooper can see the sheet, if it's configured. */
export function claimSheetUrl(): string | null {
  if (process.env.WB_CLAIMS_SHEET_URL) return process.env.WB_CLAIMS_SHEET_URL;
  const id = process.env.WB_CLAIMS_SHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

// ------------------------------------------------------------------ Google

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TIMEOUT_MS = 8000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
/** A1 tab name, quoted: 'Pending Requests' (a quote inside is doubled). */
const quoted = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

let cached: { email: string; token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.client_email && cached.until > now + 60) return cached.token;
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key).toString("base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google sign-in failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { email: sa.client_email, token: json.access_token, until: now + json.expires_in };
  return json.access_token;
}

export function googleSheet(spreadsheetId: string, keyJson: string): SheetBackend {
  const sa = JSON.parse(keyJson) as ServiceAccount;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  return {
    async tabTitles() {
      const json = await call<{ sheets: { properties: { title: string } }[] }>("?fields=sheets.properties.title");
      return json.sheets.map((s) => s.properties.title);
    },
    async read(tabs) {
      if (!tabs.length) return [];
      const q = tabs.map((t) => `ranges=${encodeURIComponent(quoted(t))}`).join("&");
      const json = await call<{ valueRanges: { values?: string[][] }[] }>(`/values:batchGet?${q}`);
      return json.valueRanges.map((v) => v.values ?? []);
    },
    async write(updates) {
      if (!updates.length) return;
      const data = updates.map((u) => ({
        range: `${quoted(u.tab)}!${columnLetter(u.firstCol - 1)}${u.row}:${columnLetter(u.firstCol - 2 + u.values.length)}${u.row}`,
        values: [u.values],
      }));
      // RAW, as Sabre Bot wrote: "05/10/2026" stays text, never a date the sheet's locale may flip
      await call("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
    },
  };
}

// ------------------------------------------------------------------ memory (tests)

/** A spreadsheet in memory: tab → rows. Same contract, no network. */
export function memorySheet(tabs: Record<string, string[][]>): SheetBackend & { tabs: Record<string, string[][]> } {
  const trim = (rows: string[][]) => {
    const out = rows.map((r) => {
      const row = [...r];
      while (row.length && !row[row.length - 1]) row.pop();
      return row;
    });
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  };
  return {
    tabs,
    async tabTitles() {
      return Object.keys(tabs);
    },
    async read(names) {
      return names.map((n) => trim(tabs[n] ?? []));
    },
    async write(updates) {
      for (const u of updates) {
        const rows = (tabs[u.tab] ??= []);
        while (rows.length < u.row) rows.push([]);
        const row = rows[u.row - 1];
        while (row.length < u.firstCol - 1 + u.values.length) row.push("");
        u.values.forEach((v, i) => (row[u.firstCol - 1 + i] = v));
      }
    },
  };
}
