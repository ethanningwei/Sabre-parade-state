> **Historical.** This is the original v1 plan from 2026-09-30, kept for context. Several decisions changed during the build:
> - Google sign-in became one shared password.
> - The Extra/RF/SOL and off-shift rules were rewritten.
> - The bot's off-shift quirk was fixed rather than kept.
> - The team-workflow section was never used.
>
> See [STATUS.md](STATUS.md) for what actually shipped.

# Sabre Company Web App — MVP: Parade State

## Context
Sabre (a company in 8SIR, SAF) has 3 admin support assistants who handle guardroom operations. Today the parade state comes from `paradestate.py`, a Telegram bot on a GCP VM. It reads a Master Config Sheet and one Google Sheet per subunit, which guardcomms (GCs) edit by hand. Most of the bot's code exists to catch sheet-structure mistakes: tab names, headers, dropdown values, orphan tabs, stale Shifts rows and links.

The goal is a mobile-first web app where GCs update attendance directly, and admins generate the parade state and then copy it or send it to Telegram. The app replaces both the Sheets and the bot. The MVP covers parade state only. Later modules (report-sick, MC tracking, leave, transport claims) will build on the same data model.

**Decisions confirmed with the user**
| Topic | Decision |
|---|---|
| Data | Own Postgres DB is the source of truth. One-time import from the current Sheets |
| Users | Admins (the 3 assistants) and GCs, who sign in with Google. Admins approve accounts |
| GC scope | A GC can edit their **whole platoon/subunit** |
| Output | Generate in the app → **Copy** button or **Send to Telegram** button (same bot token, chat and topic) |
| Old bot | Retired after cutover. Its token is reused only for sending |
| Coys | Sabre only in the UI. Schema is keyed by coy so more coys can be added later |
| Hosting | Next.js on Vercel + Neon Postgres (Singapore region) |
| Absence end | **Flag as overdue**. It never auto-reverts |
| Shifts & Extra/RF/SOL | GCs manage these for their platoon, and admins can manage everything |
| Reasons | Core codes HL/MC/OL/AL/OFF/MA, plus OTHERS with free text and autocomplete from past reasons |
| History | Every generated or sent parade state is saved |
| Strictness | **Block** generation until every issue is fixed, as the bot does now. Each issue links to the fix |
| UI | Phones first. Clean and modern, follows the system light/dark setting |

## Stack
- Next.js (App Router, TypeScript), Tailwind, shadcn/ui, deployed to Vercel with the function region set to `sin1`.
- Neon Postgres provisioned through the Vercel Marketplace (Singapore), accessed with Drizzle ORM and drizzle-kit migrations.
- Better Auth with the Google provider and a Drizzle adapter. Sessions are stored in our own DB.
- Vitest for the parade-state engine, including golden tests.
- Before writing each integration, check current docs through Context7 and the Vercel skills (nextjs, marketplace, auth, env-vars).

## Data model (`lib/db/schema.ts`)
- `coy`: key (`SABRE`), display_name (`Sabre`), telegram_chat_id, telegram_thread_id (nullable).
- `subunit`: coy_id, name (printed verbatim, e.g. `COY HQ`, `PLATOON 5`), is_hq, sort_order.
- `camp`: subunit_id, name (unique per coy), sort_order, on_shift (bool, default true). An HQ subunit has exactly one camp.
- `person`: camp_id, name (unique per camp), rank (required), role (free text, optional), sort_order, active.
- `absence`: person_id, type (`HL|MC|OL|AL|OFF|MA|OTHERS`), other_reason, start_date/start_time, end_date/end_time (times optional), ma_timing, ma_location, closed_at/closed_by, created_by.
  - A person with no open absence counts as PRESENT. A partial unique index allows only one open absence per person.
  - Closed rows are kept, which is the base for later MC/leave tracking.
- `duty` (Extra/RF/SOL): coy_id, type, rank, name, optional person_id, **camp_id FK** (this removes the "CAMP & SHIFT spelling" problem), start/end date and optional time, sort_order, closed_at.
- `parade_state`: coy_id, caa_at, text, generated_by, sent_at, sent_by, telegram_message_ids.
- `audit_log`: user_id, action, entity, entity_id, before/after jsonb, at. Every change to attendance, shifts, duties and structure is written here.
- Users (from the Better Auth tables) gain three fields: `role` (`pending|guardcomm|admin`), `subunit_id` (the GC's scope) and `active`. Bootstrap admins come from the `ADMIN_EMAILS` env var.

## Parade-state engine (`lib/parade/`): a pure TypeScript port and the core of the MVP
Port the bot's logic as pure functions on a plain `CoySnapshot` object, with no DB or I/O, so the engine can be tested exactly:
- `compute.ts`: port of `count_strength_camp` and `count_strength_platoon` (`paradestate.py:579-652`).
  - An off-shift camp counts 0 present.
  - Extra/RF/SOL are added to the platoon's present count.
  - HQ does not add Extra/RF/SOL.
  - Absentees are ordered by reason (HL, MC, OL, AL, OFF, MA, OTHERS) and then by roster order.
- `render.ts`: port of `print_camp_strength`, `print_platoon_strength` and `render_coy_parade_state` (`paradestate.py:656-871`). The output must match **character for character**, including:
  - `pad0` padding
  - "Total strength" in lowercase at platoon level
  - the separator plus trailing space and blank line
  - the MA, OTHERS and date/time variants
  - SOL dates with no times
  - CAA as `ddmmyy HH00H` in Asia/Singapore time
- `validate.ts`: replaces the bot's `ErrorCollector`. It returns typed issues, each with `{severity: 'block', scope, personId?, message, fixHref}`. The checks are:
  - missing RANK
  - HL/MC/OL/AL/OFF missing start or end date
  - MA missing timing
  - OTHERS missing reason
  - **overdue absence**, meaning the end is before the CAA time. A date-only end means 23:59 SGT that day
  - overdue Extra/RF/SOL
  - an HQ without exactly one camp
  - an empty camp

  Sheet-structure checks are dropped, because the schema and forms make those errors impossible.
- `split.ts`: port of `split_message_by_sections` with a 4000-character limit, used for sending to Telegram.
- Parity quirks are **kept on purpose** so the output matches the bot exactly. For example, a platoon's present count includes Extra/RF/SOL attached to an off-shift camp. Each quirk is marked in a comment so it can be changed later.

## Import (one-time, re-runnable until cutover)
- `scripts/export_from_sheets.py` imports `load_config`, `load_extra_rf` and `build_subunit` from `legacy/paradestate.py`, using the existing `credentials.json` and `CONFIG_SHEET_ID`.
  - It refuses to export if the bot's own validation finds problems.
  - Otherwise it writes `sabre-export.json` with the subunit and camp order, people in row order, attendance fields, Shifts and Extra/RF/SOL.
  - It also saves the bot's rendered text for the same CAA hour as a golden fixture.
- `scripts/import-sabre.ts` parses `ddmmyy[ hhmm]` into dates and times, then wipes and reloads Sabre's structure, people, open absences and duties inside one transaction. Users and history are not touched.
- `credentials.json` and the export JSON stay out of git. The JSON contains personal data.

## Screens (mobile-first, bottom nav)
- **/login** (Google). **/pending** shows while waiting for admin approval.
- **Home**: the coy strength card (e.g. 131/214), one bar per subunit, an issue count badge, and "last sent 11:02 by X".
- **Platoon** (a GC's home screen): camp cards showing present/total and an **on/off shift toggle**, plus an overdue badge.
- **Camp**: person cards with a status chip. Tapping a person opens a bottom sheet with:
  - a segmented status control
  - date/time pickers
  - an OTHERS reason with autocomplete
  - MA timing and location

  The camp screen also has:
  - multi-select bulk set (e.g. 3 people to "Clementi CO/RSM/OC Engagement")
  - search
  - quick "Returned" and "Extend" actions on overdue people
- **Duties**: Extra/RF/SOL grouped by camp. Adding one lets you pick someone from the roster (rank and name fill in) or type a free name. The camp comes from a dropdown.
- **Parade State**:
  - The CAA time defaults to the current SGT hour and can be edited.
  - If there are issues, it shows a blocking checklist, and each item deep-links to the person or duty.
  - Otherwise it shows a monospace preview, a **Copy** button, and **Send to Telegram** (confirm dialog, with a warning if one was already sent this hour).
  - Each generation or send is saved to history.
- **History**: past parade states by date, each viewable and copyable.
- **Admin**:
  - structure (subunits and camps: add, rename, reorder)
  - people (add, move camp, edit rank, deactivate)
  - users (approve, set role and platoon)
  - coy settings (display name, chat ID, thread ID, "send test message")

Authorization is checked on the server in every server action:
- A GC can only change people, camps and duties inside their `subunit_id`.
- Only admins can change structure and users.
- Only admins can send to Telegram. GCs can generate and copy.

## Telegram (`lib/telegram.ts`)
- A `sendMessage` call using `TELEGRAM_BOT_TOKEN`, the coy's chat ID and `message_thread_id` when one is set, sent in chunks.
- "Thread not found" is handled as in the bot: an alert goes to the main chat explaining the problem.
- No polling and no webhook are needed.

## Project layout
`app/` (routes above) · `lib/db/` · `lib/parade/` · `lib/auth.ts` · `lib/authz.ts` · `lib/telegram.ts` · `scripts/` · `legacy/paradestate.py` (kept unchanged) · `tests/parade/` + `tests/fixtures/`

## Build order
0. Save project and user context to memory. Run `git init`. Scaffold Next.js, Tailwind and shadcn.
1. Build the parade engine test-first: fixtures from the example in this chat, then golden tests against real bot output.
2. DB schema and migrations, Neon provisioning, Better Auth with Google, and the approval and roles flow.
3. Export and import scripts, then import the real Sabre data.
4. GC flows: Platoon → Camp → person sheet, shifts, duties, overdue handling, audit log.
5. Parade State page: validate, preview, copy, send, history.
6. Admin pages.
7. Vercel preview deploy, parity check, production cutover, then retire the VM.

## Team & workflow (3 ASAs: 2 technical + 1 product/admin)
**The split follows the code's natural seam.** The parade engine (`lib/parade/`) is pure functions on a `CoySnapshot`, so it can be built and tested with no UI or DB. The UI can be built against fixture snapshots before the DB exists. On day 1, all three agree the shared contracts: `lib/parade/types.ts` (`CoySnapshot`, `Issue`) and `lib/db/schema.ts`. After that, the two developers rarely touch the same files.

| Person | Owns | Main folders |
|---|---|---|
| **Dev A: engine & data** | Parade engine port and golden tests, validation, DB schema and migrations, export/import scripts, DB queries that build `CoySnapshot`, Telegram send | `lib/parade/`, `lib/db/`, `scripts/`, `lib/telegram.ts`, `tests/` |
| **Dev B: app & UI** | Scaffold, Better Auth with Google, approval and roles, layout and navigation, Platoon/Camp/person sheet, Duties, Parade State page, History, Admin pages, server actions and authorization | `app/`, `components/`, `lib/auth*.ts` |
| **C: product & admin** | Backlog and acceptance criteria, real data readiness, testing on phones, GC onboarding, sign-offs, future-module specs | GitHub Issues/Projects, `docs/` |

**What C does (no code needed):**
- Run the GitHub Project board, writing each issue with acceptance criteria.
- Get the current Sheets clean enough for the export to pass: fix everything the bot reports.
- Collect golden fixtures: the bot's `/print` output together with the matching sheet state.
- Test every Vercel preview URL on real phones and file bugs.
- Build the GC and admin user list: emails and platoon assignments.
- Set up a test Telegram chat, and handle BotFather changes.
- Get S6/security clearance.
- Run user acceptance testing with 1–2 real GCs.
- Write the GC quick-start guide and the cutover message.
- Spec the next modules: report-sick, MC tracking, leave, transport claims.

**GitHub setup:**
- One repo. `main` is protected: merges need a PR, 1 approval, and CI passing. CI runs typecheck, lint and vitest. Squash merges only.
- Short-lived branches (`feat/camp-screen`, `fix/overdue-date`) and small PRs merged at least daily.
- A Vercel GitHub integration gives every PR a preview URL, which is C's test link. `main` deploys to production.
- Neon branching gives each PR and each developer their own database branch, so test data never clashes.
- `CODEOWNERS`: `lib/parade/**` → A, `app/**` → B, and `lib/db/schema.ts` needs **both** developers. The schema is the one hotspot for conflicts.
- Schema changes go in their own small PR and are merged quickly, and the other developer rebases afterwards. Only one migration is in flight at a time.
- Secrets are never committed. Env vars live in Vercel (`vercel env pull`). `credentials.json` and the export JSON stay on Dev A's machine only.
- A `CLAUDE.md` and this plan are committed as `docs/PLAN.md`, so every Claude Code session on every laptop shares the same context and conventions.
- A 10-minute daily sync: what merged, what's blocked, and what C found on phones.

**Rough timeline:**
- **Day 1, all three together:** create the repo and board, scaffold, agree the types and schema, and set up the Vercel and Neon projects.
- **Week 1:**
  - A: engine plus golden tests.
  - B: auth and approval, layout, and the Camp and person sheet running on fixtures.
  - C: clean Sheets, fixtures, user list, test chat.
- **Week 2:**
  - A: import, snapshot queries, Telegram, audit log.
  - B: shifts, duties, overdue handling, Parade State page, history.
  - C: phone testing on every PR.
- **Week 3:**
  - B: admin pages.
  - A: parity run against the live bot.
  - C: user acceptance testing and security clearance. Then cutover.

## Verification
- **Golden parity**: `vitest` runs the TypeScript renderer on the imported snapshot and diffs it against the bot's output for the same CAA hour. It must be **identical to the character**. There are also unit tests for every absentee format variant, off-shift camps, HQ, SOL dates and message splitting.
- **Validation tests**: one test per blocking issue, plus a combined test confirming that several problems all appear in one run, which mirrors the guide's "break several at once" test.
- **Authorization tests**: a GC from Platoon 5 editing Platoon 6 is rejected, and a pending user sees nothing.
- **End to end on the preview deploy**: sign in as a GC, mark MC with dates, toggle a camp off shift, add an RF, then generate. The numbers should match what you'd expect. Also check copy, a send to a **test Telegram chat** (the coy chat ID is pointed at the test chat first), overdue flagging using a past end date, and a history entry.
- **Cutover**:
  1. Run the final import on the morning of cutover.
  2. Compare the app's output with the bot's `/print` output one last time.
  3. Switch the coy chat ID to the real chat and brief the GCs.
  4. Run `pkill -f paradestate.py` on the VM.
  5. Delete the VM or release its static IP. A stopped VM keeps charging for the IP.

## Out of scope for the MVP (the schema is ready for these)
Report-sick, MC/leave tracking views, transport claims, multi-coy UI, shift rotation schedules, future-dated absences, and a Telegram `/print` command.
