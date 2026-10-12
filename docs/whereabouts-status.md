# Whereabouts: status and handover

**New session? Start from the kickoff prompt in [whereabouts-kickoff.md](whereabouts-kickoff.md).** Read this file first, then [whereabouts-plan.md](whereabouts-plan.md) (the design: tables, flows, phases). After that, read `docs/STATUS.md` for the v1 domain rules this builds on.

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
| 1 | Foundation: flags, schema, Mini App shell + auth, registration, grants, `/here`, Gaps | ✅ Done 2026-10-12 (6e961be…9ecdbd2, pushed). Verified on the user's phone with @sabreopsbot on the Vercel preview: registration worked and `/here` linked the test group |
| 2 | Self-service timeline: AL/OL/OFF/MA/EVENT, approvals, leave balance, My records, void | ✅ Built 2026-10-12 (3c4b478…). Tests, build and a local walkthrough green; migration 0004 on the preview branch. **Phone check with the real bot pending** (user's checklist) |
| 3 | Medical: RSI/RSO → MC/HL/status outcomes, ONENS, evening round. **S6 sign-off before live** | ⏳ Next. Spec in §3b |
| 4 | Shifts + forecast: patterns, HOTO, min manning, forecast grid, impact on cards | — |
| 5 | RF requests + deploy | — |
| 6 | Projection into the parade state (shadow diff first) | — |
| 7 | Transport claims | — |

**Prerequisites from the user** (tick off as they arrive):
- [x] A bot made with @BotFather: **@sabreopsbot** (confirmed by the user 2026-10-12).
- [x] `WB_BOT_TOKEN` in `.env.local` and on Vercel Preview (branch `whereabouts`), 2026-10-12. The user puts it there; it's never pasted into chat. @sabreopsbot's token was in `.env.local` under `TELEGRAM_BOT_TOKEN`; rename that line to `WB_BOT_TOKEN`, and put the **old parade-state bot's** token back as `TELEGRAM_BOT_TOKEN` (the v1 Send button uses it).
- [x] `WB_WEBHOOK_SECRET` (`openssl rand -hex 32`), `WB_ADMIN_TELEGRAM_IDS` (your id from `/whoami`) and `WB_APP_URL`, in `.env.local` and on the Vercel preview. See `.env.example`.
- [ ] In @BotFather: `/newapp` for @sabreopsbot, title **Sabre**, short name **`app`** (the code builds `t.me/sabreopsbot/app`), a 640×360 photo. The app exists, but on 2026-10-12 a card's **Open** landed on the v1 sign-in page, so its URL was the bare preview address: it must be `<WB_APP_URL>/tg` (`/myapps` › @sabreopsbot › Sabre › Edit Web App URL). Privacy mode stays **on** (the default).
- [x] A test Telegram group with the user in it (linked with `/here`, 2026-10-12). Approval cards go there during development.
- [x] A Neon branch database for previews (free): branch `whereabouts`, migrated to 0003, set as the Preview `DATABASE_URL` for branch `whereabouts` with its own `AUTH_SECRET`; preview protection off; webhook set (2026-10-12). Old note: **As of 2026-10-12 Vercel's Preview environment shares Production's `DATABASE_URL`** (same variables for both) and has no `AUTH_SECRET`/`APP_PASSWORD`, and preview deployments sit behind Vercel Authentication. Give the `whereabouts` branch its own Preview `DATABASE_URL` and `AUTH_SECRET`, and turn preview protection off, before testing with Telegram. Local development uses `sabre_dev`/`sabre_test` as for v1. Apply migration `0003_wb_foundation` to it (`DATABASE_URL=<branch url> npx drizzle-kit migrate`).

---

## 3. Handover

### 3a. What exists now (Phases 1 and 2)
**Preview environment (set up 2026-10-12; use it for every phase):**
| | |
|---|---|
| URL | `https://sabre-git-whereabouts-ning-8b5f.vercel.app` (stable alias for the latest `whereabouts` build). Mini App at `/tg`. Vercel Authentication is **off** for previews |
| Vercel env | Preview, branch `whereabouts` only: `DATABASE_URL` (Neon branch), `AUTH_SECRET`, `FEATURE_WHEREABOUTS=1`, `WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_APP_URL`, `WB_ADMIN_TELEGRAM_IDS`. No `TELEGRAM_BOT_TOKEN`, so a preview can't send a parade state. Production has none of the `WB_*`/`FEATURE_*` variables |
| Database | Neon branch `whereabouts` (copy of production taken 2026-10-12: real roster, 214 active people), migrated to **0004** on 2026-10-12. Its unpooled URL is `WB_PREVIEW_DATABASE_URL` in `.env.local`. **Apply each new migration to it before pushing:** `DATABASE_URL="$WB_PREVIEW_DATABASE_URL" npx drizzle-kit migrate`. `.env.local` isn't shell-sourceable (line 15), so load it with dotenv in a `node -e` script, and check the host starts with `ep-dawn-field` (production is `ep-green-base`) |
| Bot | @sabreopsbot, webhook → `<preview>/api/wb/telegram`, privacy mode on. `npm run wb:setup -- status` (reads `WB_WEBHOOK_SECRET`/`WB_APP_URL` from `.env.local`) shows the webhook's last error; re-run `-- commands` after changing the command lists |
| Accounts | The user (Telegram id in `WB_ADMIN_TELEGRAM_IDS`) is registered, ADMIN, and PS of a platoon; a test group is linked with `/here` |
| Local | `.env.local` has `WB_BOT_TOKEN` (no `TELEGRAM_BOT_TOKEN`), `WB_WEBHOOK_SECRET`, `WB_APP_URL`, `WB_ADMIN_TELEGRAM_IDS`, `WB_PREVIEW_DATABASE_URL`. `FEATURE_WHEREABOUTS` is not set locally. The session's launch config (`~/Desktop/Claude Code/.claude/launch.json`, name `sabre-wb`) runs `next dev` with `FEATURE_WHEREABOUTS=1` and the throwaway token `123456:LOCAL-TEST-ONLY`: sign in by POSTing initData signed with that token (`tests/wb/helpers.ts` `signInitData`) to `/api/wb/auth` from the page, then set the member up in `sabre_dev` by SQL. With the throwaway token, cards and DMs fail quietly (records still save) |

**Where things are:**
| | |
|---|---|
| Flags | `lib/flags.ts`: `isEnabled`, `requireFeature()` (server actions, sync), `requireFeaturePage()` (layouts/pages; awaits `connection()` so a build with the flag off doesn't bake in a static 404), `featureOff()` (route handlers return a 404 `Response`) |
| Schema | `lib/wb/db/schema.ts`: `wb_member`, `wb_grant`, `wb_commander_chat`, `wb_audit` (0003); `wb_record`, `wb_card`, `wb_conversation` (0004, `drizzle/0004_wb_timeline.sql`). `wb_record.person_id` **cascades** on delete (see §6, Sheets re-import) |
| Migration guard | `scripts/check-migrations.ts` (run inside `npm test`): after `V1_MIGRATIONS`, every CREATE/ALTER/DROP/TRUNCATE/data change must be on a `wb_` object. A v1 migration merged from `main` must be added to `V1_MIGRATIONS` on purpose |
| Auth | `lib/wb/auth.ts`: `verifyInitData`, `signSession`/`verifySession` (`wb_session`, HMAC keyed off `AUTH_SECRET`), `signIn`, `getMember`, `requireMember`/`requireRegistered`/`requireGrantPage` (pages, redirect) and `requireGrant`/`actionMember` (actions, throw). The scope rule `grantCovers`/`hasGrant` now lives in `lib/wb/domain/grants.ts` (pure) and is re-exported from auth |
| Pure domain | `lib/wb/domain/`: `timeline.ts` (SGT half-open ranges: `dateRange`, `stampRange` (2359 = end of day), `overlaps`, `touchesDay`, `activeAt`, `daysTouched` (cap 31), `rangeLabel`, `datesLabel`, `checkRange`), `rules.ts` (kinds/states, `canDecide`, `canProxy`, `nextState`, `undoRefusal`, `leaveChange`, `leaveRefusal`, `accessTo`), `clash.ts`, `describe.ts` (labels, `recordWhat`, `eventDetail`), `holidays.ts` (MOM 2026–2027), `roles.ts` (+ `LEAVE_REASONS`, `AL_PLACES`), `registration.ts` |
| Reads | `lib/wb/records.ts`: `recordView` (record + person + camp + platoon + decider label + the trooper's member/balance), `recordsOfPerson`, `pendingFor(grants)`, `clashFor`, `lastMa`, `nowAndNext`, `peopleInScope(grants, "decide"\|"proxy")`, `personWhere`, `memberLabel`. `lib/wb/me.ts` `rosterSelf` |
| Decision core | `lib/wb/decide.ts`: `submit`, `decide` (decide-once `UPDATE … WHERE state='PENDING'`, leave in the same transaction, refuses to take a balance below 0), `undo`, `withdraw`, `voidRecord`, `sayWhy`, `sendCard`, `refreshCards`. Takes an `Outbound` (`api` + `botUsername`): the bot passes `ctx.api`; actions use `lib/wb/telegram/outbound.ts` (tests mock that module). Telegram failures are logged and never undo a decision |
| Cards | `lib/wb/telegram/cards.ts` (pure): `cardText`, `cardKeyboard`, `noticeText`, `CARD_CALLBACK` (`d:<id>:a\|r\|u\|w`). Plain text, no parse mode. Pending cards have Approve/Reject/Open; MA and event self-entries get a 📝 info card with Open only; proxy entries DM each man instead |
| Bot | `lib/wb/telegram/bot.ts`: `/start`, `/whoami`, `/here`, quick commands `/leave /off /ma /event /me` (`QUICK_COMMANDS` in `commands.ts`), card taps (`onCard`), Say why (selective `force_reply` with a `text_mention` of the decider; `wb_conversation` flow `SAY_WHY`, 10 minutes; `onReply`) |
| Actions | `lib/wb/actions/records.ts`: `checkClash`, `applyLeave`, `applyOff`, `reportMa`, `reportEvent`, `addEventFor` (≤ 40), `decideRecord`, `undoDecision`, `withdrawRecord`, `voidEntry`, `giveReason`. Phase 1: `register.ts`, `admin.ts` |
| Mini App | `app/(tg)/tg/…` + `components/tg/…`. Home (Now/Next + tiles), Apply hub, `apply/al`, `apply/ol`, `apply/off` (`leave-form.tsx`), `apply/ma`, `apply/event`, `records`, `records/[id]` (the card's Open), `approvals`, `people`, `people/[id]`, `add`, Gaps, Register, Admin. Shared: `form-bits.tsx`, `record-summary.tsx`, `record-actions.tsx`, `people-list.tsx` |
| Tests | `tests/wb/`: unit (auth, registration, links, commands, migrations, `timeline`, `rules` incl. clash/describe/holidays/accessTo), DB (`*.db.test.ts` on `sabre_test`, with `next/headers` mocked by a cookie jar): `records.db.test.ts` (full lifecycle, races, void, withdraw, proxy, scope, checks) and `bot.db.test.ts` (fake Telegram: cards, alerts, undo window, Say why, quick commands), and `flags.test.ts` (the guard test) |

**Verified 2026-10-12 (Phase 2):**
- 217 tests, typecheck, lint and `next build` green. `git diff v1.0` touches no v1 app code beyond Phase 1's approved files; `lib/parade/` is unchanged; migration 0004 only adds `wb_` objects.
- Locally (flag on, throwaway token, `sabre_dev`) on a 375px viewport: AL across Deepavali (8 and 9 Nov pre-unticked, 2 days charged) → "Saved, but PLATOON 6 has no commanders chat yet" → Approvals → Approve (balance 14 → 12) → Undo (back to pending, balance back) → Reject with a reason → Add for several men (2 picked, IPPT 0800–1200) → Home shows it under Next → Gaps "Your platoon only", collapsed by platoon.
- **Not yet verified on a phone** with the real bot: cards in the test group's topic, tapping Approve/Undo/Say why there, DMs. That's the user's checklist after pushing.

**Gotchas (Phases 1–2):**
- `notFound()` inside `run()` is swallowed into "Something went wrong", so server actions call `requireFeature()` **before** `return run(…)`. The guard test checks this pattern (and its regex needs the parameter list without parentheses inside it).
- `"use server"` files may export only async functions (types are fine): constants such as `TAKEN_MESSAGE` and `NOT_ON_ROSTER` live in `lib/wb/domain/*`.
- Client components must not import `lib/wb/db/schema.ts` (it pulls Drizzle into the bundle). Shared vocabularies go in `lib/wb/domain/*`.
- Don't use `PageProps`/`LayoutProps` for `/tg` routes: `tsc` only knows routes after `next typegen`. Dynamic params are `params: Promise<{ id: string }>`.
- The Sheets re-import (`npm run import`) deletes and recreates every `person`. That unlinks every member, drops camp/platoon grants and now **deletes every `wb_record`** (cascade). See §6.
- In tests, `vi.mock` factories are hoisted: shared state goes through `vi.hoisted`, and grammY's `Api` is built inside the factory (see `records.db.test.ts`).
- A `force_reply` is only "selective" for users mentioned in the text, so the Say why prompt carries a `text_mention` entity for the decider.

### 3b. Next phase: Phase 3 (Medical: report sick and outcomes, ONENS, evening round)
**Before building, settle with the user** the §6 questions marked *(Phase 3)*. **Gate:** S6 sign-off before any real medical data goes in. Build and test on the preview with test data only until then.

**Goal:** a trooper reports sick (RSI in camp, RSO outside) in the Mini App; his PC or PS approves it from the card, exactly like leave. Afterwards he records the outcome from My records: MC or HL (category, diagnosis, dates), up to 4 statuses, one photo of the document, and whether it's on ONENS (asked only for a civilian MC). He can also record an MC or status without a report sick (it happened elsewhere). Diagnosis and photo are visible only to him, his PC and PS, and OC/2IC/CSM; every read of them is audited; group cards show "MC 3 days · Respiratory" and never the diagnosis or the photo. A daily evening round reminds people. **Still nothing reaches the parade state** (`FEATURE_PROJECTION` stays off).

**Build:**
1. **Schema** (migration 0005, `wb_` only; ALTER on `wb_record` is allowed): add `mc_category` (text), `diagnosis` (text), `evidence_file_id` (text), `onens` (`wb_onens`: `NA`, `OWED`, `DONE`, default `NA`), `seen_by` (`MO`/`CIVILIAN`, null unless a standalone MC). Use `location` for the clinic and `reason` for symptoms on RSI/RSO. A permanent STATUS has `end_at` null (the range check already allows it).
2. **Pure domain:**
   - `roles.ts`: `MC_CATEGORIES` (Respiratory, Gastrointestinal, Musculoskeletal, Dermatological, Psychiatric, Neurological, Eye condition, Ear-Nose-Throat, Dental, Medical Appointment), `STATUSES` (LIGHT DUTY, plus "Something else" typed as written on the paper), `MAX_STATUSES = 4`.
   - `rules.ts`: RSI/RSO join `APPROVAL_KINDS`; RSI is never absent, RSO is absent for the day; MC/HL absent, STATUS never absent; outcome rows are `RECORDED` children (`parent_id`) of an `APPROVED` RSI/RSO or MA, or standalone; ONENS is owed only for an MC/HL from a civilian doctor (parent RSO, or standalone with `seen_by = CIVILIAN`); `void` cascades to live children (port `_void_kin`); a viewer may read medical fields only if `canSeeMedical(viewer, record)` (owner, `canDecide`).
   - `describe.ts`: the card line "MC 3 days · Respiratory" (no diagnosis).
3. **Mini App:**
   - **Report sick** in Apply: where (RSI/RSO) → day (not past) → clinic (RSO) → symptoms. `PENDING`, card as Phase 2. Bot quick command `/sick`.
   - **Update outcome** on an approved RSI/RSO/MA in My records and its detail page, and **Record an MC or status** standalone: got MC/HL? → kind → category → diagnosis (the doctor's words) → first/last day → (standalone) MO or civilian → got statuses? how many (1–4) → each: temporary/permanent, type, from, until (not for permanent) → one photo → ONENS (civilian MC only). Saves the children in one transaction.
   - **Photo:** see §6. Proposed: a file input in the Mini App; the client downscales to about 1600 px JPEG (under Vercel's 4.5 MB body limit); a server action sends it with `sendPhoto` to the trooper's own DM with the bot (he gets a copy) and stores the `file_id`. Nothing is stored outside Telegram.
   - **`/api/wb/file/[recordId]`**: `featureOff()`, member session, `canSeeMedical`, then `getFile` and stream the bytes; every call writes `wb_audit` (`action: "read-medical"`). Record detail shows the diagnosis and the photo through it, and logs the diagnosis view the same way.
   - **ONENS owed** (PS/PC/OC/2IC/CSM): the list of MCs still owing an upload, with "Uploaded" for the trooper on his own record.
4. **Cards:** RSI/RSO approval cards as Phase 2 (symptoms shown, they're the trooper's own words for his commander; ask the user if even that is too much). Outcome info cards: "📝 MC 3 days · Respiratory" with no diagnosis and no photo. Void of an RSI/RSO voids its outcomes too.
5. **Evening round** (`app/api/wb/cron/evening/route.ts`, `featureOff()` + `CRON_SECRET`; daily at 1900 SGT = `0 11 * * *` UTC in `vercel.json` crons, see §6):
   - an MC or status ending today: tell the trooper;
   - an MA or event tomorrow: remind the trooper;
   - ONENS still owed: remind the trooper;
   - requests pending more than 12 hours: one digest per commanders chat;
   - an RSI/RSO approved more than 24 hours ago with no outcome: chase the trooper;
   - a heartbeat line to `WB_ADMIN_TELEGRAM_IDS`.
   Idempotent per day (an `action: "evening-round"` `wb_audit` row with the date), so a retry doesn't double-send.

**Tests (Vitest):**
- Rules: RSI/RSO approval and absence, outcome children only under an approved parent, ONENS owed only for civilian MCs, void cascade, `canSeeMedical` matrix.
- DB: RSO → approve → outcome (MC + 2 statuses + photo id + ONENS owed) → children rows; standalone MC; void cascades and refunds nothing; a GC or another platoon's PS gets no diagnosis from the record view and a 403 from the file route; every diagnosis/photo read writes `wb_audit`.
- Bot on the fake Telegram: RSO card, outcome info card text has no diagnosis; the evening round sends the right messages once per day.
- Flags off: new routes and actions 404 (the guard test covers new files).
- **Still: all v1 tests green, `lib/parade/` untouched, no v1 table altered.**

**Done when:**
- `npm test`, `npm run typecheck`, `npm run lint` and `next build` are green.
- With flags off, the app behaves exactly like `v1.0`.
- On the preview with test data: report sick (RSO) → approve in the topic → update outcome with a photo → the card shows "MC n days · category" only → the PS sees the diagnosis and photo in the Mini App, a GC doesn't → the evening round run by hand sends the reminders.

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
| 2026-10-12 | Confirmed for Phase 2: `wb_record.person_id` is required, so SELF members who aren't on the roster can't apply until their PS adds and links them; proxy events use `member_id` null |
| 2026-10-12 | Phase 2 answers: GCs **are** in the platoon commanders' chats (they see cards, but a tap without a grant gets the alert). **One commanders' chat per platoon** (PL 5–8). Approvers are PC/PS of the platoon plus OC/2IC/CSM company-wide; **GCs don't approve**. Gaps defaults to the viewer's own platoon for platoon-scoped grants. Public holidays: hard-code MOM's published dates for 2026–2028 |
| 2026-10-12 | `wb_record.person_id` **cascades** on delete: v1's Sheets import deletes and recreates every person, and RESTRICT would make that import fail (v1 must keep working). The cost: a re-import now wipes the timeline (§6) |
| 2026-10-12 | Ranges are half-open `[start, end)` instants. An end time of 2359 means "to the end of the day" and is stored as the next midnight |
| 2026-10-12 | Public holidays: MOM's 2026 and 2027 lists, including the in-lieu Mondays; **2028 isn't published yet**, so 2028 leave starts with every day ticked until it's added |
| 2026-10-12 | AL, OL and Off are at most 31 days per application (split longer ones); events (courses) have no cap |
| 2026-10-12 | Approving refuses to take a balance below zero ("PTE X has only 2 days of leave left, and this needs 3"); the form already refuses over-balance applications |
| 2026-10-12 | A trooper's own MA or event also posts a 📝 info card (Open button only) to the commanders chat, as Sabre Bot did. A commander's "Add for several men" sends no card; each man with an account gets a DM instead |
| 2026-10-12 | Rejecting in the Mini App can carry the reason at once; on the card it stays one tap, with Say why after. Say why disappears from the card once a reason is in |
| 2026-10-12 | A void leaves `decided_by` as whoever approved it and writes "Voided by X: reason" in `decision_note`; the voider is in `wb_audit`. A void can't be undone. Undo also needs the decider to still hold their grant |
| 2026-10-12 | Withdrawn requests stay visible in My records (greyed), like voided ones |

---

## 6. Open questions
- The cycle lengths and anchor dates for each paired camp (needed in Phase 4).
- Minimum manning per camp, in `GC:ST CBT:ST SVC` form (needed in Phase 4).
- Sabre Bot's token is in plaintext in `sabre-bot/temp.txt`. Rotate it or delete the file. Don't reuse it.
- The preview branch's `neondb_owner` password is the same as production's and was pasted into a chat on 2026-10-12: reset it on both branches when convenient (production needs its Vercel `DATABASE_URL`/`POSTGRES_*` updated).
- `setChatMenuButton` returns ok but `getChatMenuButton` still reports `commands`; if the ☰ button doesn't open Sabre, set it in BotFather (Bot Settings › Menu Button).
- Is Vercel's `TELEGRAM_BOT_TOKEN` (production) still the old parade-state bot? Locally it had been set to @sabreopsbot. If production has it too, the v1 Send button posts as @sabreopsbot.
- **Sheets re-import vs whereabouts.** `npm run import` deletes and recreates every `person`, which would unlink every member, drop platoon/camp-scoped grants, and (since Phase 2) **delete every `wb_record`** through the cascade. Before whereabouts goes live, either stop re-importing (the STATUS.md cutover plan) or make the import update people in place. Changing the import touches v1, so it needs the user's go-ahead.
- A PS or PC can approve **their own** request (allowed for now so the user can test alone with one account). Should a commander's own request go to another commander, e.g. the PC for the PS and OC/2IC for the PC?
- Add MOM's 2028 public holidays to `lib/wb/domain/holidays.ts` when they're published (mid-2027).
- *(Phase 3)* S6's position on storing diagnoses and document photos (the gate for real data).
- *(Phase 3)* Photos: upload in the Mini App (client downscales; the server `sendPhoto`s it to the trooper's own DM and keeps the `file_id`), or have the bot ask for the photo in the DM after the form? The first is smoother; both keep photos on Telegram only.
- *(Phase 3)* The evening round needs a `crons` entry in `vercel.json` (a v1 file: needs the user's go-ahead) and `CRON_SECRET` on Vercel. Hobby allows daily crons.
- *(Phase 3)* Does RSI need approval like RSO (the plan says yes), and is it all right that the RSI/RSO card shows the trooper's symptoms to the commanders chat?
- *(Phase 3)* ONENS "done": the trooper taps "Uploaded" on his record, or does a PS confirm it?
