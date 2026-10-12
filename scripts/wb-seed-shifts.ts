// Puts the company's real shift patterns and minimum manning into a database,
// by camp name. Agreed with the user on 2026-10-12, from the Sabre Coy calendar:
//   SFT, OSU, PYAD  3 in 3 out, HOTO 2100, Team B mounted 10/10/26 2100
//   SRF             7 in 7 out (weekly 15NTM), HOTO 2100, Team B on from 12/10/26;
//                   both teams stand on the changeover Monday (flagged for checking)
//   TFT, HDN, SLR, BDK, PRC, COY HQ   Monday to Friday, public holidays off
// Minimums are per team (both teams of a pair get the camp's figure). SRF's
// "1:2:4" doesn't follow GC:ST CBT:ST SVC, so it's left unset until checked.
//
//   DATABASE_URL=<url> npx tsx scripts/wb-seed-shifts.ts            (skips camps already set)
//   DATABASE_URL=<url> npx tsx scripts/wb-seed-shifts.ts --replace  (overwrites them)
// Refuses the production database (ep-green-base) unless --production is given.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}
const replace = process.argv.includes("--replace");
if (
  new URL(url).host.startsWith("ep-green-base") &&
  !process.argv.includes("--production")
) {
  console.error(
    "That's the production database. Pass --production if you really mean it.",
  );
  process.exit(1);
}

type Pattern = {
  kind: "CYCLE" | "WEEKLY" | "ALWAYS";
  on?: number;
  off?: number;
  anchor?: string;
  both?: boolean;
};
const cycle = (anchor: string, on = 3, both = false): Pattern => ({
  kind: "CYCLE",
  on,
  off: on,
  anchor,
  both,
});
const RG: Pattern = { kind: "WEEKLY" };

const PATTERNS: Record<string, Pattern> = {
  "SFT B": cycle("2026-10-10"),
  "SFT A": cycle("2026-10-13"),
  "OSU B": cycle("2026-10-10"),
  "OSU A": cycle("2026-10-13"),
  "PYAD B": cycle("2026-10-10"),
  "PYAD A": cycle("2026-10-13"),
  "SRF B": cycle("2026-10-12", 7, true),
  "SRF A": cycle("2026-10-19", 7, true),
  TFT: RG,
  HDN: RG,
  SLR: RG,
  BDK: RG,
  PRC: RG,
  "COY HQ": RG,
};

const MINIMUMS: Record<string, [number, number, number]> = {
  BDK: [1, 4, 3],
  PRC: [1, 4, 3],
  "PYAD A": [1, 4, 3],
  "PYAD B": [1, 4, 3],
  SLR: [1, 4, 3],
  "SFT A": [1, 4, 8],
  "SFT B": [1, 4, 8],
  HDN: [1, 4, 3],
  TFT: [1, 0, 2],
  "OSU A": [1, 0, 7],
  "OSU B": [1, 0, 7],
};

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const camps = new Map(
      (
        await client.query<{ id: string; name: string }>(
          "select id, name from camp",
        )
      ).rows.map((r) => [r.name, r.id]),
    );
    const conflict = replace
      ? "do update set kind = excluded.kind, on_days = excluded.on_days, off_days = excluded.off_days, anchor_date = excluded.anchor_date, hoto_time = excluded.hoto_time, weekday_mask = excluded.weekday_mask, holidays_off = excluded.holidays_off, both_on_allowed = excluded.both_on_allowed, updated_at = now()"
      : "do nothing";
    for (const [name, p] of Object.entries(PATTERNS)) {
      const id = camps.get(name);
      if (!id) {
        console.warn(`no camp named ${name}: skipped`);
        continue;
      }
      const r = await client.query(
        `insert into wb_shift_pattern (camp_id, kind, on_days, off_days, anchor_date, hoto_time, weekday_mask, holidays_off, both_on_allowed)
       values ($1, $2, $3, $4, $5, '2100', 31, true, $6) on conflict (camp_id) ${conflict}`,
        [id, p.kind, p.on ?? 3, p.off ?? 3, p.anchor ?? null, p.both ?? false],
      );
      console.log(
        `${name}: pattern ${r.rowCount ? "set" : "already set, kept"}`,
      );
    }
    const minConflict = replace
      ? "do update set total = excluded.total, gc = excluded.gc, st_cbt = excluded.st_cbt, st_svc = excluded.st_svc, updated_at = now()"
      : "do nothing";
    for (const [name, [gc, cbt, svc]] of Object.entries(MINIMUMS)) {
      const id = camps.get(name);
      if (!id) continue;
      const r = await client.query(
        `insert into wb_min_manning (camp_id, total, gc, st_cbt, st_svc) values ($1, $2, $3, $4, $5) on conflict (camp_id) ${minConflict}`,
        [id, gc + cbt + svc, gc, cbt, svc],
      );
      console.log(
        `${name}: minimum ${gc}:${cbt}:${svc} ${r.rowCount ? "set" : "already set, kept"}`,
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
