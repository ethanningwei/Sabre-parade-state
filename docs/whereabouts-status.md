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
2. **The database is additive only.** New tables are prefixed `wb_` and live in `lib/wb/db/schema.ts`. **Never ALTER or DROP a v1 table.** `scripts/check-migrations.ts` enforces this inside `npm test`.
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
| 0 | Freeze v1, branch, plan | ✅ Done 2026-10-12: `v1.0` tag (pushed), `whereabouts` branch, plan committed |
| 1 | Foundation: flags, schema, Mini App shell + auth, registration, grants, `/here`, Gaps | ✅ Built 2026-10-12 (commits 6e961be…9ecdbd2). Tests, typecheck, lint and `next build` green. **Not yet pushed** (`origin/whereabouts` is at 4bb5cda); not yet tried with the real bot (§3a) |
| 2 | Self-service timeline: AL/OL/OFF/MA/EVENT, approvals, leave balance, My records, void | ⏳ Next. Spec in §3b |
| 3 | Medical: RSI/RSO → MC/HL/status outcomes, ONENS, evening round. **S6 sign-off before live** | — |
| 4 | Shifts + forecast: patterns, HOTO, min manning, forecast grid, impact on cards | — |
| 5 | RF requests + deploy | — |
| 6 | Projection into the parade state (shadow diff first) | — |
| 7 | Transport claims | — |

**Prerequisites from the user** (tick off as they arrive):
- [x] A bot made with @BotFather: **@sabreopsbot** (confirmed by the user 2026-10-12).
- [ ] `WB_BOT_TOKEN` in `.env.local`. The user puts it there; it's never pasted into chat. @sabreopsbot's token was in `.env.local` under `TELEGRAM_BOT_TOKEN`; rename that line to `WB_BOT_TOKEN`, and put the **old parade-state bot's** token back as `TELEGRAM_BOT_TOKEN` (the v1 Send button uses it).
- [ ] `WB_WEBHOOK_SECRET` (`openssl rand -hex 32`), `WB_ADMIN_TELEGRAM_IDS` (your id from `/whoami`) and `WB_APP_URL`, in `.env.local` and on the Vercel preview. See `.env.example`.
- [ ] In @BotFather: `/newapp` for @sabreopsbot, title **Sabre**, short name **`app`** (the code builds `t.me/sabreopsbot/app`), URL `<WB_APP_URL>/tg`, a 640×360 photo. Privacy mode stays **on** (the default).
- [ ] A test Telegram group with the user in it. Approval cards go there during development.
- [ ] A Neon branch database for previews (free). Local development uses `sabre_dev`/`sabre_test` as for v1. Apply migration `0003_wb_foundation` to it (`DATABASE_URL=<branch url> npx drizzle-kit migrate`).

---

## 3. Handover

### 3a. Phase 1: what exists now
**Try it with the real bot** (the last "Done when" item, which needs the user):
1. Fill in the prerequisites in §2 (`WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_ADMIN_TELEGRAM_IDS`, `WB_APP_URL`, BotFather `/newapp`).
2. Put `FEATURE_WHEREABOUTS=1` on the **preview** environment only (or run `next dev` behind a tunnel such as `cloudflared tunnel --url http://localhost:3000` and set `WB_APP_URL` to it).
3. `npm run wb:setup -- webhook`, then `-- menu` and `-- commands`. `npm run wb:setup -- status` shows the bot, privacy mode, the webhook and its last error.
4. On your phone: open the bot, `/start`, **Open Sabre**, register. You're ADMIN because of `WB_ADMIN_TELEGRAM_IDS`. In Admin › Grants, grant yourself PS of a platoon. Add the bot to the test group and send `/here PLATOON 6` (use the command menu, so it's sent as `/here@<bot>`).

**Where things are:**
| | |
|---|---|
| Flags | `lib/flags.ts`: `isEnabled`, `requireFeature()` (server actions, sync), `requireFeaturePage()` (layouts/pages; awaits `connection()` so a build with the flag off doesn't bake in a static 404), `featureOff()` (route handlers return a 404 `Response`) |
| Schema | `lib/wb/db/schema.ts`: `wb_member`, `wb_grant`, `wb_commander_chat`, `wb_audit`; migration `drizzle/0003_wb_foundation.sql` |
| Migration guard | `scripts/check-migrations.ts` (run inside `npm test`): after `V1_MIGRATIONS`, every CREATE/ALTER/DROP/TRUNCATE/data change must be on a `wb_` object. A v1 migration merged from `main` must be added to `V1_MIGRATIONS` on purpose |
| Auth | `lib/wb/auth.ts`: `verifyInitData`, `signSession`/`verifySession` (`wb_session`, HMAC keyed off `AUTH_SECRET`), `signIn`, `getMember`, `requireMember`/`requireRegistered`/`requireGrantPage` (pages, redirect) and `requireGrant`/`actionMember` (actions, throw). `grantCovers` is the scope rule |
| Mini App | `app/(tg)/tg/…` + `components/tg/…`. `TgShell` loads `telegram-web-app.js`, adds `.tg-themed` (mapping in `app/(tg)/tg/telegram-theme.css`), drives the BackButton and posts `initData` to `/api/wb/auth`. Screens: Home, Register, Admin (Members, Grants, Commanders' chats), Gaps |
| Registration | Pure rules in `lib/wb/domain/registration.ts` (matching, NRIC, DDMMYY, leave days) and `roles.ts` (`RANKS`, `ROLE_ALIASES`, `WB_ROLES`); actions in `lib/wb/actions/register.ts` |
| Bot | `lib/wb/telegram/bot.ts` (`createBot`, `getBot`), `commands.ts` (`matchSubunit`, command lists), `links.ts` (deep links: `admin/grants` ⇄ `startapp=admin__grants`). Webhook `app/api/wb/telegram/route.ts`; setup `app/api/wb/setup/route.ts` driven by `scripts/wb-setup.ts` |
| Tests | `tests/wb/`: unit (auth, registration, links, commands, migrations), DB (`*.db.test.ts` on `sabre_test`, with `next/headers` mocked by a cookie jar), the bot on a fake Telegram (`bot.api.config.use` captures calls), and `flags.test.ts`, which also fails if any `/tg` page, `/api/wb` route or `wb` action skips its feature guard |

**Verified 2026-10-12:**
- 132 tests, typecheck, lint and `next build` green. `git diff v1.0` touches no v1 app code; `lib/parade/` is unchanged.
- Locally with flags off: every `/tg/*` page and `/api/wb/*` route returns 404; v1 redirects to `/login` as before.
- Locally with flags on, using test `initData` signed with a throwaway token: sign-in → Register (too-many, one match, bad ORD rejected, full NRIC stored as its last 4) → Home → Admin › Grants (PS · PLATOON 6) → Gaps → Members. The Telegram theme applies.
- **Not yet verified:** a real phone inside Telegram, Telegram Web's iframe (the partitioned cookie), and `/here` against the real Bot API.

**Phase 1 gotchas for later phases:**
- `notFound()` inside `run()` is swallowed into "Something went wrong", so server actions call `requireFeature()` **before** `return run(…)`. The guard test checks this pattern.
- `"use server"` files may export only async functions: constants such as `TAKEN_MESSAGE` live in `lib/wb/domain/*`.
- Client components must not import `lib/wb/db/schema.ts` (it pulls Drizzle into the bundle). Shared vocabularies go in `lib/wb/domain/*`.
- Don't use `PageProps`/`LayoutProps` for `/tg` routes: `tsc` only knows routes after `next typegen`.
- The Sheets re-import (`npm run import`) deletes and recreates every `person`. After whereabouts is live, a re-import would unlink every member (`person_id` → null) and drop camp/platoon grants. See §6.

### 3b. Next phase: Phase 2 (Self-service timeline, shadow mode)
**Goal:** a registered trooper applies for AL, OL and OFF in the Mini App and reports MA and events; his PC or PS approves or rejects from a card in the platoon's commanders chat (Undo for 10 minutes, Say why after a reject); leave is deducted on approval. He sees everything in My records and can withdraw what's pending; a commander can void. A commander can add an event for several men at once. **Nothing reaches the parade state** (`FEATURE_PROJECTION` stays off), so v1 is unaffected.

**Build:**
1. **Schema** (new migration, `wb_` only; check-migrations must stay green):
   - `wb_record`: `id`, `person_id` (FK v1 `person`, not null), `member_id` (FK `wb_member`, null for proxy entries), `kind` (`wb_record_kind`: `RSI`, `RSO`, `MC`, `HL`, `STATUS`, `MA`, `AL`, `OL`, `OFF`, `EVENT`; the enum is complete now, Phase 3 uses the medical ones), `parent_id` (self-FK), `start_at`/`end_at` (timestamptz, half-open `[start, end)`), `absent` (bool), `state` (`wb_record_state`: `PENDING`, `APPROVED`, `REJECTED`, `RECORDED`, `CANCELLED`, `WITHDRAWN`), `decided_by` (member), `decided_at`, `decision_note`, `leave_days` (int, null unless AL/OL), `detail` (e.g. "AL @ JOHOR BAHRU"; "DV DRIVER COURSE"), `location`, `reason` (from `LEAVE_REASONS` or free text), `ma_timing` (HHMM), `created_by` (member), `created_via` (`SELF`/`PROXY`/`IMPORT`), `created_at`, `updated_at`. Index (`person_id`, `start_at`, `end_at`) and (`state`). Medical columns (`mc_category`, `diagnosis`, `evidence_file_id`, `onens`) are added in Phase 3's own migration.
   - `wb_card`: `id`, `record_id` (FK), `chat_id`, `thread_id`, `message_id`, `sent_at`. One row per card sent, so a decision can edit every copy.
   - `wb_conversation`: `id`, `telegram_user_id`, `chat_id`, `flow` (e.g. `SAY_WHY`), `step`, `answers` (jsonb), `ctx` (jsonb, e.g. `{recordId, promptMessageId}`), `updated_at`; unique on (`telegram_user_id`, `chat_id`). Only "Say why" uses it in Phase 2.
2. **Pure domain** (`lib/wb/domain/`, fully unit-tested, ports of `store.py`/`flows.py`):
   - `timeline.ts`: date range ⇄ instants in SGT (a date range `D1..D2` is `[D1 00:00 SGT, D2+1 00:00 SGT)`; a datetime range uses the times as given), `overlaps`, `touchesDay`, `daysBetween` (capped at 31 days), `activeAt`. Use `lib/parade/time.ts` (`sgtToInstant`, `toSgt`) rather than new SGT maths.
   - `rules.ts`: who approves what (AL/OL/OFF need PC or PS of the trooper's platoon; MA/EVENT are `RECORDED` straight away); the leave check (`leave_days` ≤ `leave_left`); the state machine (`PENDING` → `APPROVED`/`REJECTED`/`WITHDRAWN`; `APPROVED`/`RECORDED` → `CANCELLED` by void; `APPROVED`/`REJECTED` → `PENDING` by Undo within 10 minutes); refunds (approve deducts, undo-of-approve and void refund).
   - `clash.ts`: a trooper's live records (absent, not `REJECTED`/`CANCELLED`/`WITHDRAWN`) and open v1 `duty` rows for him (read-only) that overlap the new range, as readable lines ("AL 27/08–29/08 · approved"). It's never a refusal: the form shows **Carry on** / **Change dates**.
   - `holidays.ts`: Singapore public holidays for 2026–2028 as a constant list (see §6 for the source), used only to pre-untick leave days.
   - `LEAVE_REASONS` (`Holiday`, `Family`, `Wedding`, `Religious`, `Medical`) into `roles.ts`.
3. **Mini App screens** (`app/(tg)/tg/…`, all `requireRegistered()`; a SELF member who isn't on the roster sees "Ask your PS to add you to the parade state first" instead of the forms, because `wb_record.person_id` is required):
   - **Apply** hub with AL, OL, OFF, MA, Event.
   - **AL/OL** (ports `_leave_steps`): start and end (date + optional time, default 0000 and 2359; neither in the past; end not before start) → clash check → **days it costs** (every day ticked; weekends that are off-shift can't be known until Phase 4, so only public holidays are pre-unticked; balance shown, and over-balance is refused) → where (AL: Singapore or Johor Bahru; OL: city + country) → reason. Saves `PENDING` with `detail` "AL @ JOHOR BAHRU".
   - **OFF**: start, end → clash check. `PENDING`.
   - **MA** (ports `MA`): "Same as last time?" (offers the last MA's timing and location) → date (not in the past), time (HHMM), place. `RECORDED`, absent for that day. The photo is Phase 3.
   - **Event** (ports `_event_questions`): what, where, from/until dates, start and end time each day (default whole day). `RECORDED`, absent.
   - **My records**: one card per record, newest first, with state chips. Withdraw a `PENDING` one. Shows the decision note after a reject.
   - **Approvals** (PS/PC of the platoon; OC/2IC/CSM company-wide): pending records in scope, with the same Approve/Reject as the card. Needed when a platoon has no linked chat.
   - **Person history** (same roles, same scope): one person's records, with **Void** on `APPROVED`/`RECORDED` ones (reason required → `decision_note`).
   - **Add for several men** (PS/PC/OC/2IC/CSM/GC of the camp): pick people from the roster in scope (multi-select with search, cap 40), then the Event questions. One `RECORDED` `EVENT` row per person, `created_via='PROXY'`, `member_id` null. No clash step (as in Sabre Bot).
   - Home: replace the placeholder with "Now" (the active absent record, or "Present") and "Next" (the next one starting), plus the Apply tile.
4. **Cards and decisions** (`lib/wb/telegram/cards.ts`, `lib/wb/actions/records.ts`, `lib/wb/decide.ts`):
   - Submitting a `PENDING` record sends a card to the trooper's platoon's `wb_commander_chat` (subunit of the person's camp), in its topic if set, and saves a `wb_card`. No chat linked: the record still saves, and the trooper is told "Saved, but your platoon has no commanders chat yet. Ask your PC to send /here in it." (port `_no_chat`). Approvals in the Mini App still work.
   - Card text: kind, rank and name, camp, dates, leave days and balance after, where, reason. **No manning impact yet** (Phase 4 adds it). Buttons: **Approve**, **Reject**, **Open** (a `t.me/<bot>/app?startapp=records__<id>` link).
   - Callback data is short and opaque: `d:<recordId>:a|r|u|w` (approve, reject, undo, why). The webhook now handles `callback_query` (already in `ALLOWED_UPDATES`).
   - **Approving needs a `wb_grant`** (PC/PS covering the platoon, or OC/2IC/CSM company-wide). Anyone else who taps gets an alert "Only PLATOON 6's PC or PS can decide this". Being in the chat isn't enough.
   - **Decide once** in the database: `UPDATE wb_record SET state=… WHERE id=… AND state='PENDING' RETURNING *`; zero rows means someone else got there first, and the card is refreshed to show who. Leave is deducted in the same transaction.
   - After a decision every `wb_card` copy is edited: "✅ Approved by 2SG TAN 1432", with **Undo** (decider only, 10 minutes, checked lazily on tap against `decided_at`; no cron) and, after a reject, **Say why**. Say why sends a `force_reply` prompt and stores a `wb_conversation`; the reply becomes `decision_note`, and the trooper is told.
   - The trooper gets a DM for approve, reject (with the note when given), undo and void. If the DM fails (he blocked the bot), log it and carry on.
   - Every decision, withdraw and void is written to `wb_audit` (`via` `BOT` or `MINIAPP`).
5. **Bot quick commands** (DM): `/leave`, `/off`, `/ma`, `/event`, `/me` reply with a `web_app` button straight to that screen. Add them to `PRIVATE_COMMANDS`.
6. **Gaps**: default to the viewer's own platoon when their grants are platoon-scoped (company-wide roles still see everything); collapse "Not registered" by platoon. This was too long to scroll with 213 people.

**Tests (Vitest):**
- Timeline: overlaps and touches across midnight and SGT boundaries, half-open ends, the 31-day cap; ported `checks.py` cases where they apply.
- Rules: approval matrix, state transitions (including illegal ones), leave deduct/refund on approve, undo and void, over-balance refused.
- Clash: finds overlapping records and duties, ignores rejected/cancelled/withdrawn.
- DB: apply AL → card row → approve (balance down) → undo (balance back) → reject → Say why stores the note; two approvers racing: only one wins; void refunds; withdraw only while pending; proxy add for 3 men creates 3 rows.
- Bot on the fake Telegram: card sent to the right chat and topic; a tap from someone without a grant gets the alert and changes nothing; the card is edited after the decision; Undo after 10 minutes is refused; the DM to the trooper is sent.
- Flags off: all new routes and actions 404 (the guard test covers new files automatically).
- **Still: all v1 tests green, `lib/parade/` untouched, no v1 table altered.**

**Done when:**
- `npm test`, `npm run typecheck`, `npm run lint` and `next build` are green.
- With flags off, the app behaves exactly like `v1.0`.
- On the preview with the test bot: the user applies for AL from their phone, the card appears in the test group's topic, they approve it there, Undo works, a reject with Say why reaches the trooper's DM, and My records and the leave balance match.

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
| 2026-10-12 | The whereabouts bot is **@sabreopsbot**; its Mini App is titled **Sabre** with short name `app` |
| 2026-10-12 | Phase 1: `/tg` pages decide the flag **per request** (`requireFeaturePage` awaits `connection()`), so a build made with the flag off doesn't bake in a static 404 |
| 2026-10-12 | `WB_ADMIN_TELEGRAM_IDS` is checked on **every** sign-in, not just the first: the env list is the break-glass. To take ADMIN from someone on it, remove them from the env as well |
| 2026-10-12 | ADMIN is a role like any other, not a wildcard: a check lists ADMIN explicitly where admins should pass (`/here`, Gaps). The last active ADMIN can't be removed, and an admin can't deactivate themselves |
| 2026-10-12 | Grant scope: company-wide (no platoon/camp) covers everything; a platoon grant covers its camps; a camp grant covers that camp only |
| 2026-10-12 | Registration matches **all** active roster names, including ones already linked, so a trooper is told "already registered to another account, ask your PS" instead of "not on the roster". Up to 6 matches are offered as a list (Sabre Bot used 8) |
| 2026-10-12 | Session cookie `wb_session` is stateless (HMAC with a key derived from `AUTH_SECRET`), but `getMember()` re-reads the member each request, so deactivation and grant changes apply at once. Deactivating doesn't need a session table |
| 2026-10-12 | `/api/wb/setup` runs on the deployment, authorised by `WB_WEBHOOK_SECRET`, so the bot token never leaves Vercel (same pattern as sabre-ir) |
| 2026-10-12 | One commanders chat per platoon (`wb_commander_chat.subunit_id` unique). `/here` in a new chat replaces the old one and says so. One chat may serve several platoons (one `/here` per platoon, e.g. one forum with a topic each) |
| 2026-10-12 | The approved flag-guarded v1 nav link was **not** added: the Mini App only works inside Telegram, so a link from the v1 web app would only show "Open Sabre from the bot". Revisit if there's a reason |
| 2026-10-12 | Proposed for Phase 2 (confirm when it starts): `wb_record.person_id` is required, so SELF members who aren't on the roster can't apply until their PS adds and links them; proxy events use `member_id` null |

---

## 6. Open questions
- Are GCs in the platoon commanders' chats today, or do they get only DMs?
- Does each platoon have its own commanders' chat, or is it one forum group with a topic per platoon?
- The cycle lengths and anchor dates for each paired camp (needed in Phase 4).
- Minimum manning per camp, in `GC:ST CBT:ST SVC` form (needed in Phase 4).
- S6 position on storing medical data and photos (needed before Phase 3 goes live).
- Sabre Bot's token is in plaintext in `sabre-bot/temp.txt`. Rotate it or delete the file. Don't reuse it.
- Is Vercel's `TELEGRAM_BOT_TOKEN` (production) still the old parade-state bot? Locally it had been set to @sabreopsbot. If production has it too, the v1 Send button posts as @sabreopsbot.
- **Sheets re-import vs whereabouts.** `npm run import` deletes and recreates every `person`, which would unlink every member and drop platoon/camp-scoped grants. Before whereabouts goes live, either stop re-importing (the STATUS.md cutover plan) or make the import update people in place. Changing the import touches v1, so it needs the user's go-ahead.
- Should a PS see Gaps for the whole company or only their platoon? Phase 2 plans "own platoon by default" (§3b item 6).
- Public holiday list for leave days (Phase 2): hard-code MOM's published dates for 2026–2028, or something else?
- Do GCs approve anything, or only PC/PS? Phase 2 assumes only PC/PS (and OC/2IC/CSM company-wide), as in the plan.
