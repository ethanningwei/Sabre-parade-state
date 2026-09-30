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
You can re-run this as many times as you like until cutover. Users, platoon assignments and history are kept. People, absences and duties are replaced.

1. Put the bot's `credentials.json` in the repo root. It is gitignored and should be treated like a password.
2. One-time setup: `python3 -m venv .venv && ./.venv/bin/pip install --upgrade gspread pandas python-telegram-bot python-dotenv google-auth`
3. `./.venv/bin/python scripts/export_from_sheets.py "PL5-8 COY"` uses the bot's own code to read and validate the Sheets. Sabre's key in the bot's config sheet is `PL5-8 COY`.
   - If Google briefly fails to open a sheet ("please check that the spreadsheet link … is working"), just run it again.
   - If the bot would report problems, you get the same numbered list. Fix them in the Sheets and run it again.
   - Otherwise it writes `sabre-export.json`. This file contains personal data: don't commit or share it, and delete it after importing.
4. `npm run import` loads the data, then renders the parade state from the database at the bot's CAA and compares it with the bot's output.
   - `✅ PARITY` means the app prints exactly what the bot printed.
   - Any cell the app can't represent is listed, for example a date written `28/09/26` instead of `280926`.

**Into production:** `.env.production.local` (gitignored) holds the production `DATABASE_URL_UNPOOLED`.
```bash
DATABASE_URL="$(grep '^DATABASE_URL_UNPOOLED=' .env.production.local | cut -d= -f2- | tr -d '"')" npm run import
rm sabre-export.json
```
Re-import only during the parallel run. After cutover the app is the source of truth: a re-import would overwrite everyone's attendance.

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

## Cutover from the bot
1. On the morning of cutover, export and import (see above) and confirm `✅ PARITY`.
2. In Admin › Coy settings, check the chat ID and thread ID, then press **Send test message**.
3. Brief the GCs: share the URL and the password (in person or over a secure channel).
4. Stop the bot on the VM: `pkill -f paradestate.py`.
5. Delete the VM, or release its static IP. A *stopped* VM keeps charging for the IP.

## Next: v2
See [docs/STATUS.md](docs/STATUS.md) §5: report sick, MC tracking, leave and transport claims, plus individual logins.
