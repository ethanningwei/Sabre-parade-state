// Guards the whereabouts rule "the database is additive only": no migration
// after v1.0 may ALTER, DROP, TRUNCATE or otherwise change a v1 table, type or
// index. New objects must be wb_-prefixed. Runs in `npm test`
// (tests/wb/check-migrations.test.ts) and on its own:
//   npx tsx scripts/check-migrations.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The migrations shipped in v1.0 (6486fb2). Everything after these is checked. */
export const V1_MIGRATIONS = ["0000_init", "0001_shared_password", "0002_camp_post_duty_absence"];

export interface Violation {
  file: string;
  statement: string;
  reason: string;
}

const name = String.raw`(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?`;
const ifExists = String.raw`(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`;

// What each statement touches, and whether that object must be wb_.
const RULES: { re: RegExp; what: string }[] = [
  { re: new RegExp(String.raw`^ALTER\s+TABLE\s+${ifExists}(?:ONLY\s+)?${name}`, "i"), what: "ALTER TABLE" },
  { re: new RegExp(String.raw`^DROP\s+TABLE\s+${ifExists}${name}`, "i"), what: "DROP TABLE" },
  { re: new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?${name}`, "i"), what: "TRUNCATE" },
  { re: new RegExp(String.raw`^(?:ALTER|DROP)\s+TYPE\s+${ifExists}${name}`, "i"), what: "ALTER/DROP TYPE" },
  { re: new RegExp(String.raw`^(?:ALTER|DROP)\s+INDEX\s+(?:CONCURRENTLY\s+)?${ifExists}${name}`, "i"), what: "ALTER/DROP INDEX" },
  { re: new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?${ifExists}${name}\s+ON\s+(?:ONLY\s+)?${name}`, "i"), what: "CREATE INDEX" },
  { re: new RegExp(String.raw`^CREATE\s+TABLE\s+${ifExists}${name}`, "i"), what: "CREATE TABLE" },
  { re: new RegExp(String.raw`^CREATE\s+TYPE\s+${name}`, "i"), what: "CREATE TYPE" },
  { re: new RegExp(String.raw`^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?${name}`, "i"), what: "data change" },
  { re: new RegExp(String.raw`^(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|RULE|POLICY)\s+`, "i"), what: "trigger/rule/policy" },
];

const isWb = (n: string) => n.toLowerCase().startsWith("wb_");

/** Strip comments, split on drizzle's breakpoints and semicolons. */
export function statements(sql: string): string[] {
  return sql
    .replace(/--> statement-breakpoint/g, ";")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function checkSql(file: string, sql: string): Violation[] {
  const out: Violation[] = [];
  for (const statement of statements(sql)) {
    const rule = RULES.find((r) => r.re.test(statement));
    if (!rule) continue;
    if (rule.what === "trigger/rule/policy") {
      out.push({ file, statement, reason: "triggers, rules and policies are not allowed in whereabouts migrations" });
      continue;
    }
    // every captured name (index + its table, or the one object) must be wb_
    const names = statement.match(rule.re)!.slice(1).filter(Boolean);
    const bad = names.filter((n) => !isWb(n));
    if (bad.length) {
      out.push({ file, statement, reason: `${rule.what} on non-wb_ object ${bad.map((b) => `"${b}"`).join(", ")}` });
    }
  }
  return out;
}

export function checkMigrations(dir = join(process.cwd(), "drizzle")): Violation[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !V1_MIGRATIONS.includes(f.replace(/\.sql$/, "")))
    .sort();
  return files.flatMap((f) => checkSql(f, readFileSync(join(dir, f), "utf8")));
}

if (process.argv[1]?.endsWith("check-migrations.ts")) {
  const violations = checkMigrations();
  for (const v of violations) console.error(`✗ ${v.file}: ${v.reason}\n    ${v.statement.slice(0, 200)}`);
  if (violations.length) process.exit(1);
  console.log("✓ migrations after v1.0 only add wb_ objects");
}
