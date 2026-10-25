# Sabre

Web app for Sabre coy (8SIR) company processes. v1 replaces the parade-state Telegram bot (`legacy/paradestate.py`) and its Google Sheets.

> **New session? Read [docs/STATUS.md](docs/STATUS.md) first.** It covers what's live, the domain rules, the decisions log, known limitations and where v2 starts.

- Guardcomms (GCs) update attendance, shifts and Extra/RF/SOL for their platoon on their phones.
- Everyone signed in can also manage people and structure, and generate the parade state.
- Before generating, the app checks everything. If anything is wrong, it lists every problem and produces nothing, just like the bot did.
- A clean state can be copied, or sent to the coy's Telegram chat/topic with the old bot's token.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui (Base UI) · Postgres + Drizzle · Vitest.

**Sign-in:** one shared password (`APP_PASSWORD`). Each person also types their rank and name, which is recorded against every change and in History. Everyone signed in has full access. Ten wrong passwords from one IP blocks it for 15 minutes, and changing `APP_PASSWORD` signs everyone out. The `role` and `subunitId` columns and the `assertCanEdit*` checks are still there for when individual logins return.

## Layout
| Path | What |
|---|---|
| `lib/parade/` | **The engine.** A pure TypeScript port of the bot's counting, formatting, validation and message splitting. No DB or I/O. |
| `lib/db/schema.ts` | Tables: coy › subunit › camp (with `post` = physical camp) › person, absence (open = absent, closed = history, `duty_id` for automatic RF/Extra absences), duty (Extra/RF/SOL), parade_state (history), audit_log, user, app_session, login_failure. |
| `lib/actions/` | Server actions. Every one checks the signed-in user first. |
| `lib/session.ts`, `lib/authz.ts` | Shared-password sessions and access checks. |
| `lib/data/` | Snapshot loading (`snapshot.ts`), per-request memo (`current.ts`), and the Sheets import (`parse-export.ts`, `write-coy.ts`). |
| `app/(app)/` | Screens: Overview, Platoon `/s/[id]`, Camp `/c/[id]`, Duties, Parade, History, Admin. |
| `scripts/` | `export_from_sheets.py` and `import-sabre.ts` (the one-time migration), plus `seed-example.ts`. |
| `tests/` | Golden tests against the bot's real output, validation, import and DB round-trip tests. |
| `docs/` | `STATUS.md` (start here), `v1-plan.md` (historical). |

## Output parity
The parade-state text matches the bot **character for character**. `tests/fixtures/example-300926.txt` is a real bot output, and the tests render it from the engine, from the database, and from a simulated Sheets import.

The app is stricter than the bot in a few places: it ignores off-shift camps, follows the shift rules for SOL, and never lets RF/Extra count twice. On consistent data it prints the same text. See `docs/STATUS.md` §2.

## Local development
```bash
npm install
createdb sabre_dev && createdb sabre_test
cp .env.example .env.local        # fill in DATABASE_URL, AUTH_SECRET (openssl rand -base64 32), APP_PASSWORD
npm run db:migrate && npm run db:migrate:test
npm run seed                      # example Sabre data (placeholder names), or `npm run import`, see below
npm run dev
```
```bash
npm test          # all tests (DB tests use sabre_test)
npm run typecheck
npm run lint
```

## Importing the real data from Google Sheets
The import updates people **in place**: each Sheet row is matched to the person already in the app (same camp and name, or the same name in another camp when only one person has it), then edited, moved or added. Anyone the Sheet no longer has is marked inactive, never deleted, and comes back with their history if the Sheet has them again. Users, platoon assignments, history and whereabouts data are kept. By default absences, duties, on-shift and the Telegram chat are **left as the app has them**.

1. Put the bot's `credentials.json` in the repo root. It is gitignored and should be treated like a password.
2. One-time setup: `python3 -m venv .venv && ./.venv/bin/pip install --upgrade gspread pandas python-telegram-bot python-dotenv google-auth`
3. `./.venv/bin/python scripts/export_from_sheets.py "PL5-8 COY"` uses the bot's own code to read and validate the Sheets. Sabre's key in the bot's config sheet is `PL5-8 COY`.
   - If Google briefly fails to open a sheet ("please check that the spreadsheet link … is working"), just run it again.
   - If the bot would report problems, you get the same numbered list. Fix them in the Sheets and run it again.
   - Otherwise it writes `sabre-export.json`. This file contains personal data: don't commit or share it, and delete it after importing.
4. `npm run import -- --dry-run` prints what the import would do (edited, moved, back, added, removed, likely renames) and writes nothing. Check it first.
   - It refuses to run while a name is **ambiguous** (more than one person has it and they can't be told apart) or the Sheet has dropped a camp or subunit (delete it in Admin, or put it back).
   - Any cell the app can't represent is listed, for example a date written `28/09/26` instead of `280926`.
5. `npm run import` updates people and structure. If anyone would be marked inactive it stops and asks you to run it again with `--yes`.
   - It makes the roster match the Sheet. Anyone added in the app (Sabre's Roster, or Admin › People) who isn't in the Sheet goes inactive, and renames or moves made in the app are undone. While you still import, put roster changes in the Sheet too, and check the dry run for them.
6. Parallel run only: `npm run import -- --with-absences --yes` also replaces every absence, duty, on-shift and the Telegram chat with the Sheet's, then renders the parade state from the database at the bot's CAA and compares it with the bot's output. `✅ PARITY` means the app prints exactly what the bot printed. It overwrites what GCs typed in the app.

**Which database:** the import writes to `DATABASE_URL` from `.env.local`, which is your **local** database (its first line names the host). The whereabouts preview and production are separate databases.

**Into the whereabouts preview:** `.env.local` holds its unpooled URL as `WB_PREVIEW_DATABASE_URL`:
```bash
DATABASE_URL="$(grep '^WB_PREVIEW_DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" npm run import -- --dry-run
```

**Into production:** `.env.production.local` (gitignored) holds the production `DATABASE_URL_UNPOOLED`.
```bash
DATABASE_URL="$(grep '^DATABASE_URL_UNPOOLED=' .env.production.local | cut -d= -f2- | tr -d '"')" npm run import -- --dry-run
rm sabre-export.json
```
Then the same without `--dry-run` (plus `--yes` if it asks). After cutover the app is the source of truth for attendance: never use `--with-absences` then. A plain import (people only) stays safe.

An SOL typed under the other team (e.g. SFT B) is automatically tied to the person in SFT A when the name matches.

## Deploying (Vercel + Neon)
Environment variables to set in Vercel:

| Variable | Value |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Neon Postgres, Singapore region. Added automatically by the Marketplace integration. The app uses the pooled URL; migrations and imports use the unpooled one. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_PASSWORD` | The shared sign-in password. Make it long, e.g. four random words. |
| `TELEGRAM_BOT_TOKEN` | The old bot's token (the `TOKEN=` line in `.env` on the VM) |

Functions are pinned to Singapore (`sin1`) in `vercel.json`, next to the database. Pushing to `main` deploys to production.

**Migrations:** run them against production **before** pushing code that needs them, and keep new columns additive or nullable so the running deploy keeps working:
```bash
DATABASE_URL="$(grep '^DATABASE_URL_UNPOOLED=' .env.production.local | cut -d= -f2- | tr -d '"')" npx drizzle-kit migrate
```

**Telegram:** the chat ID and topic ID are set in **Admin › Coy settings**, with a **Send test message** button. The bot must be a member of the group.

## Backups
`.github/workflows/backup.yml` runs every night at 0300 SGT (and on demand from the Actions tab). It runs `scripts/backup.sh`, which:
- dumps the database;
- restores the dump into a throwaway Postgres 18 and checks every table's row count matches (the **restore drill**);
- encrypts the dump with [age](https://age-encryption.org) for each ASA's key.

The file is kept as a workflow artifact for 30 days and, if the backup bot is set up, sent to its Telegram chat. The dump holds medical data, so it is never stored unencrypted. A failed run emails the repo owner. Neon's own restore window (6 hours on the free plan) covers mistakes from the last few hours.

**Setup** (once, in GitHub › Settings › Secrets and variables › Actions):
1. Each ASA runs `age-keygen -o ~/sabre-backup-key.txt` (`brew install age`) and keeps that file safe, e.g. in a password manager. It prints a public key, `age1…`.
2. Variable `BACKUP_AGE_RECIPIENTS`: the public keys, one per line.
3. Secret `BACKUP_DATABASE_URL`: production's **unpooled** Neon URL.
4. Optional off-site copy: make a separate bot with @BotFather used only for backups (never @sabreopsbot: its token can sign anyone in to the Mini App), press Start in its DM, then set secret `BACKUP_TELEGRAM_BOT_TOKEN` and variable `BACKUP_TELEGRAM_CHAT_ID` (your Telegram id).
5. Actions › Nightly backup › **Run workflow** once and check it's green. Scheduled runs only happen from `main`.

**Restoring** (into an **empty** database: a new Neon project or branch, or a local scratch one). Needs `pg_restore` 18 (`brew install libpq`):
```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" scripts/restore-backup.sh sabre-2026-10-25-0300.dump.age ~/sabre-backup-key.txt "<empty database URL>"
```
It refuses a database that already has tables, and prints every table's row count at the end. Then point `DATABASE_URL` at it. **Monthly drill:** restore the latest file into a scratch Neon branch and check the counts look right.

## Cutover from the bot
1. On the morning of cutover, export and import (see above) and confirm `✅ PARITY`.
2. In Admin › Coy settings, check the chat ID and thread ID, then press **Send test message**.
3. Brief the GCs: share the URL and the password (in person or over a secure channel).
4. Stop the bot on the VM: `pkill -f paradestate.py`.
5. Delete the VM, or release its static IP. A *stopped* VM keeps charging for the IP.

## Next: v2
See [docs/STATUS.md](docs/STATUS.md) §5: report sick, MC tracking, leave and transport claims, plus individual logins.
