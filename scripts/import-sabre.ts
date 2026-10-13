// Loads sabre-export.json (from scripts/export_from_sheets.py) into the
// database, updating people in place (lib/data/write-coy.ts): it prints what it
// will do first, and anyone the Sheet no longer has is marked inactive, never
// deleted, so whereabouts records and Telegram links survive.
//
//   npm run import -- --dry-run         # print the plan; write nothing
//   npm run import                      # people and structure only (sabre-export.json)
//   npm run import -- other-export.json
//   npm run import -- --yes             # needed when anyone would be marked inactive
//   npm run import -- --with-absences --yes
//       also replace absences, duties and on-shift with the Sheet's, then PROVE
//       the import: render the parade state at the bot's CAA and compare it with
//       the bot's own output, character for character. Pre-cutover only: it
//       overwrites what GCs have typed in the app.

import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  const withAbsences = args.includes("--with-absences");
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
  const { planRoster, sheetRows, sheetStructure, formatRosterPlan, rosterBlockers } = await import("@/lib/data/roster-plan");
  const { loadRoster, rosterStakes } = await import("@/lib/data/roster-db");
  const stop = async (code: number) => {
    await db.$client.end();
    process.exit(code);
  };

  const current = await loadRoster(db, input.coy.key);
  const plan = planRoster(current.people, sheetRows(input), {
    structure: { current: current.structure, sheet: sheetStructure(input) },
    inactive: current.inactive,
  });
  const atRisk = [...plan.removed, ...plan.ambiguous.flatMap((a) => a.current)].map((r) => r.id);
  const where = `${input.coy.displayName} (${new URL(process.env.DATABASE_URL!).host})`;
  console.log(formatRosterPlan(plan, await rosterStakes(db, atRisk), dryRun ? `DRY RUN, nothing written. ${where}` : where));

  if (dryRun) return stop(0);
  const blockers = rosterBlockers(plan);
  if (blockers.length) {
    console.error(`\n❌ Not imported:\n${blockers.map((b) => `- ${b}`).join("\n")}`);
    return stop(1);
  }
  if (!yes && (plan.removed.length || withAbsences)) {
    console.error(
      `\nNot imported yet. ${[
        plan.removed.length && `${plan.removed.length} would be marked inactive.`,
        withAbsences && "--with-absences replaces every absence, duty and on-shift with the Sheet's, including what GCs typed in the app.",
      ]
        .filter(Boolean)
        .join(" ")} Check the list above, then run it again with --yes.`,
    );
    return stop(1);
  }

  const { writeCoy } = await import("@/lib/data/write-coy");
  const { loadSnapshot, getCoyByKey } = await import("@/lib/data/snapshot");
  const { renderParadeState } = await import("@/lib/parade");

  const result = await writeCoy(db, input, withAbsences ? "full" : "roster");
  console.log(`\nImported ${input.coy.displayName}:`, result);
  if (!withAbsences) {
    console.log("Absences, duties and on-shift are left as the app has them.");
    return stop(0);
  }

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
