// Loads sabre-export.json (from scripts/export_from_sheets.py) into the
// database, then PROVES the import: renders the parade state from the DB at the
// bot's CAA and compares it with the bot's own output, character for character.
//
//   npm run import                      # sabre-export.json
//   npm run import -- other-export.json
//   npm run import -- --dry-run         # what an in-place import would do to the roster; writes nothing
//
// Re-runnable until cutover: structure is upserted, people/absences/duties are
// replaced. Users, platoon assignments and history are kept.

import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--")) ?? "sabre-export.json";
  const { parseExport, parseCaaLine } = await import("@/lib/data/parse-export");
  const data = JSON.parse(readFileSync(path, "utf8"));

  const { input, problems } = parseExport(data);
  if (problems.length) {
    console.error(`⚠️ ${problems.length} cell(s) can't be imported. Fix them in the sheets, re-export, and try again:\n`);
    problems.forEach((p, i) => console.error(`${i + 1}. ${p}`));
    process.exit(1);
  }

  const { db } = await import("@/lib/db");

  if (dryRun) {
    const { planRoster, sheetRows, sheetCamps, formatRosterPlan } = await import("@/lib/data/roster-plan");
    const { loadRoster, rosterStakes } = await import("@/lib/data/roster-db");
    const current = await loadRoster(db, input.coy.key);
    const plan = planRoster(current.people, sheetRows(input), { current: current.camps, sheet: sheetCamps(input) });
    const atRisk = [...plan.removed, ...plan.ambiguous.flatMap((a) => a.current)].map((r) => r.id);
    const stakes = await rosterStakes(db, atRisk);
    console.log(formatRosterPlan(plan, stakes, `${input.coy.displayName} (${new URL(process.env.DATABASE_URL!).host})`));
    await db.$client.end();
    process.exit(0);
  }

  const { writeCoy } = await import("@/lib/data/write-coy");
  const { loadSnapshot, getCoyByKey } = await import("@/lib/data/snapshot");
  const { renderParadeState } = await import("@/lib/parade");

  const result = await writeCoy(db, input);
  console.log(`Imported ${input.coy.displayName}:`, result);

  const caa = parseCaaLine(data.caaLine);
  if (!caa) throw new Error(`Can't read the bot's CAA line: ${data.caaLine}`);
  const text = renderParadeState(await loadSnapshot(await getCoyByKey(input.coy.key)), caa);

  if (text === data.botText) {
    console.log(`\n✅ PARITY: the app's parade state is identical to the bot's (${data.caaLine}).`);
    process.exit(0);
  }
  console.error("\n❌ PARITY MISMATCH — first differing lines (bot vs app):");
  const a = data.botText.split("\n");
  const b = text.split("\n");
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 10; i++) {
    if (a[i] !== b[i]) {
      console.error(`line ${i + 1}\n  bot: ${JSON.stringify(a[i])}\n  app: ${JSON.stringify(b[i])}`);
      shown++;
    }
  }
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
