# Whereabouts: status and handover

**New session? Read this file first, then [whereabouts-plan.md](whereabouts-plan.md)** (the design: tables, flows, phases). After that, read `docs/STATUS.md` for the v1 domain rules this builds on.

- **Branch:** `whereabouts`. Never commit whereabouts work to `main` directly. `main` is the live parade-state app.
- **Tag:** `v1.0` (6486fb2) is the parade-state app before any whereabouts work.
- **One phase per session.** At the end of each session, update §2 (progress), §5 (decisions) and §6 (open questions), and write a **handover note** for the next phase in §3.

---

## 1. Ground rules (apply to every phase)
1. **The parade-state app must keep working alone.** This is the user's hard requirement: the parade state is being rolled out now.
   - All whereabouts code runs only when `FEATURE_WHEREABOUTS=1`. When off, `/tg/*` and `/api/wb/*` return 404, and the crons and projector do nothing.
   - `FEATURE_PROJECTION` (timeline → v1 `absence`/`duty`) stays off until Phase 6.
   - `FEATURE_CLAIMS` gates Phase 7.
   - Production has all flags **off** until the user turns them on.
2. **The database is additive only.** New tables are prefixed `wb_` and live in `lib/wb/db/schema.ts`. **Never ALTER or DROP a v1 table.** `scripts/check-migrations.ts` enforces this once it exists (Phase 1).
3. **Never edit `lib/parade/`.** The golden parity tests must stay green (`npm test`).
4. **Keep v1 edits minimal:**
   - Already approved: the `drizzle.config.ts` schema array and a flag-guarded nav link.
   - Planned for Phase 6: extracting the bodies of `setStatus`, `setCampShift`, `saveDuty` and `endDuty` into plain functions. No behaviour change.
   - Anything else touching v1 files: ask the user first.
5. **It must stay free:** Vercel Hobby + Neon free + Telegram.
   - Crons run **at most once a day**. Anything time-sensitive is done lazily, on write or on read.
   - Don't add paid services, Vercel Blob or extra databases.
   - MC/MA photos stay on Telegram; we store only the `file_id`.
6. **Separate bot token.** The whereabouts bot uses `WB_BOT_TOKEN` on a webhook. `TELEGRAM_BOT_TOKEN` is the old parade-state bot, used only to send the parade state. Never point a webhook at it.
7. **Medical privacy:**
   - Diagnosis and document photos are never posted to a group chat. Cards say "MC 3 days · Respiratory".
   - They're visible only to the trooper, their PC and PS, and OC, 2IC and CSM.
   - Every read is logged in `wb_audit`.
   - Store only the last 4 of an NRIC.
8. **Auto mode blocks `git push`.** Commit on `whereabouts` and ask the user to push.
9. **Check library docs:** grammY, the Telegram Mini App API (`initData`) and Drizzle via Context7. Next 16 via `node_modules/next/dist/docs/` (see AGENTS.md).

---

## 2. Progress
| Phase | Scope | State |
|---|---|---|
| 0 | Freeze v1, branch, plan | ✅ Done 2026-10-12: `v1.0` tag, `whereabouts` branch, plan committed. **Not yet pushed** |
| 1 | Foundation: flags, schema, Mini App shell + auth, registration, grants, `/here`, Gaps | ⏳ Next. Spec in §3 |
| 2 | Self-service timeline: AL/OL/OFF/MA/EVENT, approvals, leave balance, My records, void | — |
| 3 | Medical: RSI/RSO → MC/HL/status outcomes, ONENS, evening round. **S6 sign-off before live** | — |
| 4 | Shifts + forecast: patterns, HOTO, min manning, forecast grid, impact on cards | — |
| 5 | RF requests + deploy | — |
| 6 | Projection into the parade state (shadow diff first) | — |
| 7 | Transport claims | — |

**Prerequisites from the user** (tick off as they arrive):
- [ ] A bot made with @BotFather. Suggested: display name **Sabre Coy**, username **@sabrecoybot**; no "8SIR" in the username, because usernames are public. Make it from an account that stays with the appointment.
- [ ] `WB_BOT_TOKEN` in `.env.local`. The user puts it there; it's never pasted into chat.
- [ ] A test Telegram group with the user in it. Approval cards go there during development.
- [ ] A Neon branch database for previews (free). Local development uses `sabre_dev`/`sabre_test` as for v1.

---

## 3. Next phase: Phase 1 (Foundation)
**Goal:** a trooper can open @sabrecoybot, launch the Mini App, register against the roster, and see a placeholder Home. An admin can grant roles and link commanders' chats. Nothing is recorded yet.

**Build:**
1. **`lib/flags.ts`:** `isEnabled('WHEREABOUTS' | 'PROJECTION' | 'CLAIMS')` reads `FEATURE_*` (`"1"` means on). Also `requireFeature()`, which calls `notFound()`. Use it in every `(tg)` layout and page and in every `api/wb` route.
2. **Schema** (`lib/wb/db/schema.ts`, Phase 1 tables only; later phases add theirs in their own migrations):
   - `wb_member`: `telegram_user_id` unique, `person_id` (nullable, FK to v1 `person`), `full_name`, `nric4`, `ord_date`, `leave_left`, `stayout` (`NONE`/`PERM`/`TEMP`), `stayout_until`, `source` (`ROSTER`/`SELF`). For SELF sign-ups also `self_rank`, `self_role` and `self_camp_id`. Plus `registered_at`, `active`.
   - `wb_grant`
   - `wb_commander_chat`
   - `wb_audit`

   Add the schema to `drizzle.config.ts` as an array (`["./lib/db/schema.ts", "./lib/wb/db/schema.ts"]`). Generate the migration, then run `scripts/check-migrations.ts` (fails if any migration after `v1.0` ALTERs or DROPs a non-`wb_` table) inside `npm test`.
3. **Auth** (`lib/wb/auth.ts`):
   - Verify `initData` with HMAC-SHA256 (secret = HMAC("WebAppData", `WB_BOT_TOKEN`)), rejecting anything older than 24 hours.
   - Issue a stateless signed cookie (`wb_session`; HMAC with `AUTH_SECRET`; `SameSite=None; Secure; Partitioned`; 7 days).
   - Provide `requireMember()` and `requireGrant(role, scope)`.
   - Bootstrap admins from `WB_ADMIN_TELEGRAM_IDS` (comma-separated). They're granted `ADMIN` on first login.
4. **Mini App shell** (`app/(tg)/tg/layout.tsx`):
   - Load the `telegram-web-app.js` script. Map `--tg-theme-*` onto the shadcn tokens. Wire up the BackButton.
   - An auth bootstrap client component posts `initData` to `/api/wb/auth` and sets the cookie.
   - Must not depend on the v1 password session.
5. **Registration** (port of Sabre Bot `flows.py` `REGISTER` and `engine.py` `_after_match_name`/`_after_pick_man`/`_after_confirm_match`):
   1. Type a name and match it against active v1 `person` rows, case-insensitive and partial. More than 6 matches: type more. 2–6: pick from a list. 1: "That's me?".
   2. Already linked to another member: refuse and tell them to ask their PS.
   3. Fill in full name, NRIC last 4 (truncate a full NRIC), ORD (DDMMYY), leave left, and stay-out (none, permanent, or until a date).
   4. No match: retry, or "I'm not on it", which asks platoon, camp, role and rank and saves as `SELF`.
6. **Admin screens** (ADMIN only): Members (link or unlink a person, deactivate) · Grants (role + platoon/camp scope) · Commanders' chats (list or remove).
7. **Gaps screen** (PS, PC, OC, 2IC, CSM, ASA, ADMIN): roster people with no member, SELF members not yet on the roster, and members whose person has left (inactive).
8. **Bot** (`lib/wb/telegram/`, grammY):
   - Webhook route `app/api/wb/telegram/route.ts`, which checks `X-Telegram-Bot-Api-Secret-Token` against `WB_WEBHOOK_SECRET`.
   - Commands:
     - `/start` replies with an **Open Sabre** `web_app` button. In groups it uses a `t.me/<bot>/app` link instead.
     - `/whoami` gives the chat id, thread id and your Telegram id.
     - `/here PLATOON 6` links this chat or topic. It needs PC/PS for that platoon, or ADMIN, and replies with what it displaced.
   - Keep privacy mode **on**.
9. **Setup script** `scripts/wb-setup.ts` (`npm run wb:setup -- status|webhook|menu|commands`). Same pattern as `~/Developer/sabre-ir` `api/setup.ts`. It sets the webhook with the secret, the chat menu button to the Mini App URL, and per-scope command lists. The token is never printed.
10. **`.env.example`:** add `FEATURE_WHEREABOUTS`, `FEATURE_PROJECTION`, `FEATURE_CLAIMS`, `WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_ADMIN_TELEGRAM_IDS` and `WB_APP_URL`, each with a comment.

**Tests (Vitest):**
- `initData` verify: valid, tampered, expired.
- Cookie sign and verify.
- Name matching: exact, partial, ambiguous, already linked.
- NRIC truncation.
- Grant scope checks.
- Flags off: the route handlers return 404 (call the handlers directly).
- `check-migrations`.
- DB round trip for registration on `sabre_test`.
- **All existing v1 tests stay green.**

**Done when:**
- `npm test`, `npm run typecheck` and `npm run lint` are green.
- With flags off, the app behaves exactly like `v1.0`.
- With flags on locally (exposed with a tunnel, or on a Vercel preview with the test bot), the user can register from their phone, grant themselves PS of a platoon, and `/here` the test group.

---

## 4. Telegram layout (decided 2026-10-12)
| Where | Who | What the bot does there |
|---|---|---|
| A DM with each trooper | Everyone | Opens the Mini App. Decision notices, reminders (MA tomorrow, MC ends, ONENS owed) |
| Each platoon commanders' chat (PL 5–8), or a forum topic, linked with `/here` | PC, PS (GCs if already members) | That platoon's approval cards with manning impact, the evening digest, RF cards |
| COY HQ chat | OC, 2IC, CSM, ASAs | RF requests company-wide, transport claims for the OC, escalations of unanswered requests |
| Not in: troopers' platoon groups, the parade-state topic | — | The parade state is still sent by the v1 app with the old token |

- **Approving needs a `wb_grant`.** Being in the chat isn't enough, which is a change from Sabre Bot. Anyone else who taps sees "Only PL 6's PC or PS can decide this".
- All forms are in the Mini App. The bot is thin: cards, notices, deep links, `/here`, and replies for "Say why".

---

## 5. Decisions log
| Date | Decision |
|---|---|
| 2026-10-12 | Option 5 (bot + Mini App, one DB), built inside the Sabre repo behind feature flags so the parade-state app can run alone |
| 2026-10-12 | Shifts follow a fixed cycle; a HOTO confirms it or re-anchors it |
| 2026-10-12 | Full medical data like Sabre Bot (diagnosis + photo `file_id`); S6 sign-off before Phase 3 goes live |
| 2026-10-12 | Scope: whereabouts + RF requests/deploy + transport claims. No broadcast for now |
| 2026-10-12 | Must be free: Vercel Hobby, Neon free, Telegram; daily crons only |
| 2026-10-12 | Separate bot (suggested @sabrecoybot), with explicit grants for approvals, and privacy mode on |
| 2026-10-12 | One phase per session; this file is the handover |

---

## 6. Open questions
- Final bot name and username: the user is choosing; the suggestion is @sabrecoybot.
- Are GCs in the platoon commanders' chats today, or do they get only DMs?
- Does each platoon have its own commanders' chat, or is it one forum group with a topic per platoon?
- The cycle lengths and anchor dates for each paired camp (needed in Phase 4).
- Minimum manning per camp, in `GC:ST CBT:ST SVC` form (needed in Phase 4).
- S6 position on storing medical data and photos (needed before Phase 3 goes live).
- Sabre Bot's token is in plaintext in `sabre-bot/temp.txt`. Rotate it or delete the file. Don't reuse it.
