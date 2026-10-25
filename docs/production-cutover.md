# Production cutover: whereabouts replaces v1

The plan for making the `whereabouts` branch the production app at **sabreapp.vercel.app**, with Telegram as the only way in and the old bot and Sheets retired. Written 2026-10-25. Tick the boxes as you go.

**Status (2026-10-25, evening):** B1–B5 done.
- Production is **sabreapp.vercel.app**. `sabre-ir.vercel.app` is a different Vercel project: it was set by mistake, then fixed and redeployed.
- B3 gave `✅ PARITY` at CAA 251026 2000H.
- In B6 the webhook, commands and claims are done, but @BotFather's Menu Button and Mini App URL are still to change.
- B7 onward are still to do.

**What we found (2026-10-25):**
- **Production's database** (Neon `ep-green-base`) is v1's: migrations 0000–0002, 209 people, nothing written since 2026-10-03.
- **The preview's database** (`ep-hidden-sea`, a branch of the same Neon project) has every migration to 0012, but only test Mini App data (3 members, 8 records).
- So production **keeps its own database and is migrated** (every whereabouts migration is additive). On the day, the roster and absences come fresh from the Sheets. Nothing is copied from the preview.
- `main` has nothing that `whereabouts` lacks, so the merge is a fast-forward.

---

## A. In the days before (nobody notices)

- [x] **A1. Password sign-in off** (done 2026-10-25). With `APP_PASSWORD` unset, `/login` shows "Open @sabreopsbot" instead of the form, and the sign-in action refuses. `WB_BOT_USERNAME` changes the bot it names; the default is `sabreopsbot`.
- [x] **A2. Tests:** `npm test`, `npm run typecheck` and `npm run lint` green on `whereabouts`.
- [ ] **A3. Commit or discard** the uncommitted change in `scripts/import-sabre.ts` before using the import.
- [ ] **A4. Rotate the leaked Neon password.** `neondb_owner` is shared by both branches and was pasted into a chat on 2026-10-12.
  - Reset it in Neon › Roles.
  - Update Vercel's `DATABASE_URL`/`POSTGRES_*`/`PG*` (the Marketplace integration may do this itself: check), `.env.production.local` and `.env.local`.
- [ ] **A5. Neon compute.** In Neon › Branches › `main` › Compute, set autoscaling max to **0.25 CU**, so a busy day can't burn the free 100 CU-hours early.
- [ ] **A6. Rollback point.** In Neon, create branch `v1-final` from `main`.
- [ ] **A7. Backup keys.** Each ASA runs `age-keygen`, and you collect the public keys. Optionally make a backup-only bot. See README › Backups.
- [ ] **A8. Pick the time.** Choose a quiet evening after the last parade state, with the other ASAs. Tell PCs/PSs/GCs what changes and when.

## B. Cutover (about 1–2 hours)

Run the database commands with production's unpooled URL from `.env.production.local`:
```bash
export PROD_URL="$(grep '^DATABASE_URL_UNPOOLED=' .env.production.local | cut -d= -f2- | tr -d '"')"
```

- [x] **B1. Migrate production** (0003–0012; additive, so live v1 keeps working):
  ```bash
  DATABASE_URL="$PROD_URL" npx drizzle-kit migrate
  ```
- [x] **B2. Shift patterns and minimums:**
  ```bash
  DATABASE_URL="$PROD_URL" npx tsx scripts/wb-seed-shifts.ts --production
  ```
- [x] **B3. Last import from the Sheets**, with absences, because production's are from September:
  ```bash
  ./.venv/bin/python scripts/export_from_sheets.py "PL5-8 COY"
  DATABASE_URL="$PROD_URL" npm run import -- --dry-run
  DATABASE_URL="$PROD_URL" npm run import -- --with-absences --yes
  rm sabre-export.json
  ```
  Expect `✅ PARITY`. This is the **last ever** `--with-absences`: from here on the app is the source of truth.
- [x] **B4. Vercel › Settings › Environment Variables, Production.**
  - **Copy from Preview (`whereabouts`):** `FEATURE_WHEREABOUTS=1`, `FEATURE_CLAIMS=1`, `WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_ADMIN_TELEGRAM_IDS`, `WB_GOOGLE_SERVICE_ACCOUNT`, `WB_CLAIMS_SHEET_ID`, `WB_CLAIMS_SHEET_URL`.
  - **`WB_APP_URL`:** `https://sabreapp.vercel.app`.
  - **`CRON_SECRET`:** new, `openssl rand -hex 32`. Vercel sends it to the evening-round cron.
  - **`TELEGRAM_BOT_TOKEN`:** set it to **@sabreopsbot's token**, the same value as `WB_BOT_TOKEN`, so the parade state is sent by @sabreopsbot. Sending needs no webhook, so this is safe.
  - **`FEATURE_PROJECTION=1`:** a decision. With it on, approved Mini App records go into the parade state; with it off, GCs type them again.
  - **Remove `APP_PASSWORD`**, once A1 is deployed.
  - **Keep `AUTH_SECRET` and the Neon variables as they are.**
- [x] **B5. Deploy:**
  ```bash
  git checkout main && git merge --ff-only whereabouts && git push origin main
  ```
  Wait for the production deployment to go green on Vercel.
- [ ] **B6. Point @sabreopsbot at production.** This is the moment the preview stops getting Telegram updates.
  ```bash
  WB_APP_URL=https://sabreapp.vercel.app npm run wb:setup -- webhook
  WB_APP_URL=https://sabreapp.vercel.app npm run wb:setup -- menu
  WB_APP_URL=https://sabreapp.vercel.app npm run wb:setup -- commands
  WB_APP_URL=https://sabreapp.vercel.app npm run wb:setup -- claims
  WB_APP_URL=https://sabreapp.vercel.app npm run wb:setup -- status
  ```
  Then in @BotFather › /myapps › Sabre › Edit Web App URL: `https://sabreapp.vercel.app/tg`. Change `WB_APP_URL` in `.env.local` too.
- [ ] **B7. Chats.**
  - Add @sabreopsbot to the coy parade-state group, allowed to post in its topic.
  - Check Admin › Coy settings (the import set the chat and topic from the config sheet) and press **Send test message**.
  - Run `/here` in each platoon commanders' chat and `/here HQ` in COY HQ's. Production starts with no linked chats.
- [ ] **B8. People.**
  - You (an admin from `WB_ADMIN_TELEGRAM_IDS`) register first.
  - Give OC/2IC/CSM/PC/PS their grants in Admin › Members.
  - Then everyone registers. Roster › "Not registered" shows who's left.
- [ ] **B9. Smoke test on your phone:**
  - open the Mini App;
  - open the parade state;
  - apply for leave with a second account and approve it from the card;
  - generate the parade state and send it to the topic.
- [ ] **B10. Retire the old way.**
  - If `paradestate.py` still runs on the GCP VM, stop it (`pkill -f paradestate.py`) and delete the VM. A stopped VM still charges for its IP.
  - Make the Sheets read-only for GCs.

## C. The week after

- [ ] **C1. Evening round.** The first evening, check that it ran: Vercel › Cron Jobs, or the heartbeat DM to the admins. Hobby fires it between 1900 and 1959.
- [ ] **C2. Backups on.**
  - Set `BACKUP_DATABASE_URL` (production's unpooled URL, after A4's rotation) and `BACKUP_AGE_RECIPIENTS` in GitHub.
  - Run Actions › Nightly backup › Run workflow and check it's green.
  - Restore that file once into a scratch database with `scripts/restore-backup.sh`.
- [ ] **C3. Move the preview out of production's Neon project,** so it stops using production's CU-hours.
  - Create a free project `sabre-preview` (Singapore).
  - Restore a backup of the `whereabouts` Neon branch into it.
  - Point Vercel's Preview `DATABASE_URL` at it.
  - Delete the branch from the production project.
  - The preview then needs its own bot (a second @BotFather bot) to be testable, because @sabreopsbot's webhook now points at production.
- [ ] **C4. Neon usage.** Check it every week for the first month (Neon › Billing › Usage). Over about 100 CU-hours a month means Launch (about US$13–19 a month), or the database is suspended.
- [ ] **C5. Housekeeping.**
  - Revoke the retired Sabre Bot's token and delete `sabre-bot/temp.txt`.
  - Remove `APP_PASSWORD` from Preview.
- [ ] **C6. Docs.**
  - `docs/STATUS.md` and `whereabouts-status.md` say whereabouts is production.
  - Ground rule 1 ("flags off in production") is retired.
  - v1-only notes become history.

## Rollback

- **The code:** Vercel › Deployments › the last v1 production deployment › **Instant Rollback**. The migrations are additive, so v1 runs on the migrated database.
- **The bot:** the Mini App goes dark (v1 has no `/tg`). Tell the men to wait, or point the webhook back at the preview while you fix it.
- **The data:** Neon's 6-hour restore window, the `v1-final` branch (A6), or last night's backup.
