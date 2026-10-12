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
| 2 | Self-service timeline: AL/OL/OFF/MA/EVENT, approvals, leave balance, My records, void | ✅ Done 2026-10-12 (3c4b478…89bb596, pushed). Verified on the user's phone with @sabreopsbot on the preview: the full checklist (apply, card in the topic, approve/undo, reject/Say why, withdraw, MA/event, Approvals, void, Add for several men, Gaps, Open from a card) |
| 3 | Medical: RSI/RSO → MC/HL/status outcomes, ONENS, evening round. **S6 sign-off before live** | 🧪 Built 2026-10-12 (958b4a4…, not pushed yet), migration 0005 on the preview branch. **Waiting for the user's phone check** (checklist in §3a) and S6 sign-off before real medical data |
| 4 | Shifts + forecast: patterns, HOTO, min manning, forecast grid, impact on cards | ⏳ Next. Spec in §3b |
| 5 | RF requests + deploy | — |
| 6 | Projection into the parade state (shadow diff first) | — |
| 7 | Transport claims | — |

**Prerequisites from the user** (tick off as they arrive):
- [x] A bot made with @BotFather: **@sabreopsbot** (confirmed by the user 2026-10-12).
- [x] `WB_BOT_TOKEN` in `.env.local` and on Vercel Preview (branch `whereabouts`), 2026-10-12. The user puts it there; it's never pasted into chat. @sabreopsbot's token was in `.env.local` under `TELEGRAM_BOT_TOKEN`; rename that line to `WB_BOT_TOKEN`, and put the **old parade-state bot's** token back as `TELEGRAM_BOT_TOKEN` (the v1 Send button uses it).
- [x] `WB_WEBHOOK_SECRET` (`openssl rand -hex 32`), `WB_ADMIN_TELEGRAM_IDS` (your id from `/whoami`) and `WB_APP_URL`, in `.env.local` and on the Vercel preview. See `.env.example`.
- [x] In @BotFather: `/newapp` for @sabreopsbot, title **Sabre**, short name **`app`** (the code builds `t.me/sabreopsbot/app`), URL `<WB_APP_URL>/tg` (fixed 2026-10-12: it had been the bare preview address, so a card's **Open** landed on the v1 sign-in). Privacy mode stays **on** (the default).
- [x] A test Telegram group with the user in it (linked with `/here`, 2026-10-12). Approval cards go there during development.
- [ ] `CRON_SECRET` (`openssl rand -hex 32`) on Vercel **Production** before whereabouts is switched on there: Vercel sends it to the evening-round cron. Not needed on the preview (Vercel crons only run on production; run the round by hand with `npm run wb:setup -- evening`).
- [ ] **S6 sign-off** on storing diagnoses and document photos. Until then, test data only.
- [x] A Neon branch database for previews (free): branch `whereabouts`, migrated to 0003, set as the Preview `DATABASE_URL` for branch `whereabouts` with its own `AUTH_SECRET`; preview protection off; webhook set (2026-10-12). Old note: **As of 2026-10-12 Vercel's Preview environment shares Production's `DATABASE_URL`** (same variables for both) and has no `AUTH_SECRET`/`APP_PASSWORD`, and preview deployments sit behind Vercel Authentication. Give the `whereabouts` branch its own Preview `DATABASE_URL` and `AUTH_SECRET`, and turn preview protection off, before testing with Telegram. Local development uses `sabre_dev`/`sabre_test` as for v1. Apply migration `0003_wb_foundation` to it (`DATABASE_URL=<branch url> npx drizzle-kit migrate`).

---

## 3. Handover

### 3a. What exists now (Phases 1–3)
**Preview environment (set up 2026-10-12; use it for every phase):**
| | |
|---|---|
| URL | `https://sabre-git-whereabouts-ning-8b5f.vercel.app` (stable alias for the latest `whereabouts` build). Mini App at `/tg`. Vercel Authentication is **off** for previews |
| Vercel env | Preview, branch `whereabouts` only: `DATABASE_URL` (Neon branch), `AUTH_SECRET`, `FEATURE_WHEREABOUTS=1`, `WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_APP_URL`, `WB_ADMIN_TELEGRAM_IDS`. No `TELEGRAM_BOT_TOKEN`, so a preview can't send a parade state. Production has none of the `WB_*`/`FEATURE_*` variables |
| Database | Neon branch `whereabouts` (copy of production taken 2026-10-12: real roster, 214 active people), migrated to **0005** on 2026-10-12. Its unpooled URL is `WB_PREVIEW_DATABASE_URL` in `.env.local`. **Apply each new migration to it before pushing:** `DATABASE_URL="$WB_PREVIEW_DATABASE_URL" npx drizzle-kit migrate`. `.env.local` isn't shell-sourceable (line 15), so load it with dotenv in a `node -e` script, and check the host starts with `ep-dawn-field` (production is `ep-green-base`) |
| Bot | @sabreopsbot, webhook → `<preview>/api/wb/telegram`, privacy mode on. `npm run wb:setup -- status` (reads `WB_WEBHOOK_SECRET`/`WB_APP_URL` from `.env.local`) shows the webhook's last error; re-run `-- commands` after changing the command lists. `-- evening` runs the evening round on the deployment now (forced) |
| Accounts | The user (Telegram id in `WB_ADMIN_TELEGRAM_IDS`) is registered, ADMIN, and PS of a platoon; a test group is linked with `/here` |
| Local | `.env.local` has `WB_BOT_TOKEN` (no `TELEGRAM_BOT_TOKEN`), `WB_WEBHOOK_SECRET`, `WB_APP_URL`, `WB_ADMIN_TELEGRAM_IDS`, `WB_PREVIEW_DATABASE_URL`. `FEATURE_WHEREABOUTS` is not set locally. The session's launch config (`~/Desktop/Claude Code/.claude/launch.json`, name `sabre-wb`) runs `next dev` with `FEATURE_WHEREABOUTS=1` and the throwaway token `123456:LOCAL-TEST-ONLY`: sign in by POSTing initData signed with that token (`tests/wb/helpers.ts` `signInitData`) to `/api/wb/auth` from the page, then set the member up in `sabre_dev` by SQL. With the throwaway token, cards and DMs fail quietly (records still save) |

**Where things are:**
| | |
|---|---|
| Flags | `lib/flags.ts`: `isEnabled`, `requireFeature()` (server actions, sync), `requireFeaturePage()` (layouts/pages; awaits `connection()` so a build with the flag off doesn't bake in a static 404), `featureOff()` (route handlers return a 404 `Response`) |
| Schema | `lib/wb/db/schema.ts`: `wb_member`, `wb_grant`, `wb_commander_chat`, `wb_audit` (0003); `wb_record`, `wb_card`, `wb_conversation` (0004, `drizzle/0004_wb_timeline.sql`); 0005 (`drizzle/0005_wb_medical.sql`) adds to `wb_record`: `mc_category`, `diagnosis`, `evidence_file_id`, `onens` (`wb_onens` NA/OWED/DONE), `seen_by` (`wb_seen_by` MO/CIVILIAN), `outcome_at`, and an index on `parent_id`. `wb_record.person_id` **cascades** on delete (see §6, Sheets re-import) |
| Migration guard | `scripts/check-migrations.ts` (run inside `npm test`): after `V1_MIGRATIONS`, every CREATE/ALTER/DROP/TRUNCATE/data change must be on a `wb_` object. A v1 migration merged from `main` must be added to `V1_MIGRATIONS` on purpose |
| Auth | `lib/wb/auth.ts`: `verifyInitData`, `signSession`/`verifySession` (`wb_session`, HMAC keyed off `AUTH_SECRET`), `signIn`, `getMember`, `requireMember`/`requireRegistered`/`requireGrantPage` (pages, redirect) and `requireGrant`/`actionMember` (actions, throw). The scope rule `grantCovers`/`hasGrant` now lives in `lib/wb/domain/grants.ts` (pure) and is re-exported from auth |
| Pure domain (Phase 3) | `rules.ts`: RSI/RSO in `APPROVAL_KINDS`; `isAbsentKind` (RSI and STATUS no; RSO, MC, HL yes), `VISIT_KINDS`/`OUTCOME_KINDS`, `outcomeParentRefusal`, `onensFor` (owed only for a civilian MC: under an RSO, or `seen_by = CIVILIAN` when standalone or under an MA), `asksSeenBy`, `kinOf` (void cascade), `canSeeMedical` (owner or `canDecide`), `MAX_STATUSES`. `roles.ts`: `MC_CATEGORIES`, `STATUSES`. `describe.ts`: `recordWhat` for RSI/RSO/MC/HL/STATUS ("MC 3 days · 14/10–16/10 · Respiratory", never the diagnosis), `mcCategoryOf`, `statusLabel` |
| Pure domain | `lib/wb/domain/`: `timeline.ts` (SGT half-open ranges: `dateRange`, `stampRange` (2359 = end of day), `overlaps`, `touchesDay`, `activeAt`, `daysTouched` (cap 31), `rangeLabel`, `datesLabel`, `checkRange`), `rules.ts` (kinds/states, `canDecide`, `canProxy`, `nextState`, `undoRefusal`, `leaveChange`, `leaveRefusal`, `accessTo`), `clash.ts`, `describe.ts` (labels, `recordWhat`, `eventDetail`), `holidays.ts` (MOM 2026–2027), `roles.ts` (+ `LEAVE_REASONS`, `AL_PLACES`), `registration.ts` |
| Medical reads | **`RecordView` never contains `diagnosis` or `evidence_file_id`** (`records.ts` selects every other column). `lib/wb/medical.ts` is the only reader: `readDiagnoses(viewer, records, via)` and `readPhoto(viewer, record)` check `canSeeMedical` and write a `wb_audit` row (`action: "read-medical"`, `after: { field }`) per value returned; `photoIds` says which records have a photo without reading it. `lib/wb/visits.ts`: `visitOf` (a record's RSI/RSO/MA or standalone head, and its live outcome), `answersFrom` (prefill for a correction) |
| Outcomes | `lib/wb/outcome.ts`: `saveOutcome` (MC/HL + up to 4 statuses + one photo; under a visit, standalone, or replacing the live outcome: old rows → `CANCELLED` "Corrected by X"; nothing given → only `outcome_at` on the visit) and `markOnens`. All rows of one outcome share one `created_at`, which is how `decide.ts` `outcomeBatch` finds them for the card. Standalone: the MC (or first status) is the head with `parent_id` null, the rest hang off it |
| Photos | `lib/wb/photo.ts`: `storePhoto` (`sendPhoto` to the trooper's own DM, keeps the largest size's `file_id`), `signPhotoToken`/`verifyPhotoToken` (HMAC, key `wb-photo:` + `AUTH_SECRET`, names the member, 2 h), `photoBytes` (`getFile` + fetch). Routes: `POST /api/wb/photo` (multipart, ≤ 4 MB, JPEG/PNG/WebP; a route handler because server actions are capped at 1 MB and `next.config.ts` is v1), `GET /api/wb/file/[recordId]` (audited, `no-store`, 404 for anyone not allowed). The client shrinks to 1600 px JPEG first (`components/tg/photo-picker.tsx`) |
| Evening round | `lib/wb/evening.ts` `eveningRound(out, now, { force })`: MC/HL/status ending today (DM + platoon digest), MA/event tomorrow (DM), ONENS owed (DM with `o:<id>` Uploaded buttons), RSI/RSO approved > 24 h with no outcome (DM with Update outcome; gives up after 14 days), requests pending > 12 h (digest line + Open Approvals), one digest per commanders chat, heartbeat to `WB_ADMIN_TELEGRAM_IDS` last. Once a day: an `evening-round` `wb_audit` row keyed by the SGT date, claimed under an advisory lock before anything is sent. Route `GET /api/wb/cron/evening` (`featureOff`, `Authorization: Bearer $CRON_SECRET`, `?force=1`); `vercel.json` cron `0 11 * * *` (approved) |
| Reads | `lib/wb/records.ts`: `recordView` (record + person + camp + platoon + decider label + the trooper's member/balance), `recordsOfPerson`, `pendingFor(grants)`, `clashFor`, `lastMa`, `nowAndNext`, `peopleInScope(grants, "decide"\|"proxy")`, `personWhere`, `memberLabel`; Phase 3: `recordViews`, `childrenOf`, `findViews`, `onensOwedFor`. `lib/wb/me.ts` `rosterSelf` |
| Decision core | Phase 3: `voidRecord` cancels the record **and its live children** (an RSO and its MC) with one note and audits `alsoVoided`; `undo` is refused once an outcome exists ("Void it instead"); an approved RSI/RSO DMs an **Update outcome** button; `refreshCards` redraws an outcome's card from its whole batch; `tell`, `inTx`, `Refusal`, `outcomeBatch`, `outcomeOrder` are exported for `outcome.ts`/`evening.ts`. Phase 2: `submit`, `decide` (decide-once `UPDATE … WHERE state='PENDING'`, leave in the same transaction, refuses to take a balance below 0), `undo`, `withdraw`, `voidRecord`, `sayWhy`, `sendCard`, `refreshCards`. Takes an `Outbound` (`api` + `botUsername`): the bot passes `ctx.api`; actions use `lib/wb/telegram/outbound.ts` (tests mock that module). Telegram failures are logged and never undo a decision |
| Cards | `lib/wb/telegram/cards.ts` (pure): `cardText`, `cardKeyboard`, `noticeText`, `CARD_CALLBACK` (`d:<id>:a\|r\|u\|w`). Phase 3: RSI/RSO cards add "Symptoms: …"; `outcomeCardText`/`outcomeKeyboard` ("📝 Outcome recorded" / "✏️ Outcome corrected" + Replaces; Open → the visit); `ONENS_CALLBACK` (`o:<id>`); notices `ending`, `tomorrow`, `onens`, `chase`. A `CardRecord` has no diagnosis field, so nothing built here can carry one. Plain text, no parse mode. Pending cards have Approve/Reject/Open; MA and event self-entries get a 📝 info card with Open only; proxy entries DM each man instead |
| Bot | `lib/wb/telegram/bot.ts`: `/start`, `/whoami`, `/here`, quick commands `/sick /leave /off /ma /event /me`, `onOnens` (the evening reminder's Uploaded button: owner or decider, removes just that button) (`QUICK_COMMANDS` in `commands.ts`), card taps (`onCard`), Say why (selective `force_reply` with a `text_mention` of the decider; `wb_conversation` flow `SAY_WHY`, 10 minutes; `onReply`) |
| Actions | Phase 3: `records.ts` `reportSick`; `lib/wb/actions/medical.ts` `recordOutcome` (verifies the photo token), `markUploaded`. `lib/wb/actions/records.ts`: `checkClash`, `applyLeave`, `applyOff`, `reportMa`, `reportEvent`, `addEventFor` (≤ 40), `decideRecord`, `undoDecision`, `withdrawRecord`, `voidEntry`, `giveReason`. Phase 1: `register.ts`, `admin.ts` |
| Mini App | Phase 3: `apply/sick` (`sick-form.tsx`), `apply/outcome` (standalone) and `records/[id]/outcome` (Update or Correct; `outcome-form.tsx`, `photo-picker.tsx`), the record page's **What the doctor gave** (`visit-section.tsx`: diagnosis with a lock and the photo for those allowed, Uploaded to ONENS, Update/Correct), My records nests an outcome under its visit, `onens` (commanders' owed list, `onens-button.tsx`), Home tile "ONENS owed · n", Apply tiles. `Choice`/`YesNo` now live in `form-bits.tsx`. Phase 1–2: `app/(tg)/tg/…` + `components/tg/…`. Home (Now/Next + tiles), Apply hub, `apply/al`, `apply/ol`, `apply/off` (`leave-form.tsx`), `apply/ma`, `apply/event`, `records`, `records/[id]` (the card's Open), `approvals`, `people`, `people/[id]`, `add`, Gaps, Register, Admin. Shared: `form-bits.tsx`, `record-summary.tsx`, `record-actions.tsx`, `people-list.tsx` |
| Tests | Phase 3: `medical-rules.test.ts` (approval/absence, outcome parents, ONENS, void cascade, `canSeeMedical` matrix, card lines); `records.db.test.ts` "medical (DB)" (RSO → card with symptoms → approve → outcome with MC + 2 statuses + photo; diagnosis never in any Telegram payload; who sees the diagnosis/photo and the audit rows; standalone + correction keeping the photo; refusals incl. a borrowed token; nothing given; void cascade; ONENS); `bot.db.test.ts` (evening round once a day, digest, heartbeat, the ONENS tap, `/sick`); `flags.test.ts` covers the three new routes and `CRON_SECRET`. The fake Telegram now answers `sendPhoto` and `getFile`. Phases 1–2: `tests/wb/`: unit (auth, registration, links, commands, migrations, `timeline`, `rules` incl. clash/describe/holidays/accessTo), DB (`*.db.test.ts` on `sabre_test`, with `next/headers` mocked by a cookie jar): `records.db.test.ts` (full lifecycle, races, void, withdraw, proxy, scope, checks) and `bot.db.test.ts` (fake Telegram: cards, alerts, undo window, Say why, quick commands), and `flags.test.ts` (the guard test) |

**Verified 2026-10-12 (Phase 2):**
- 217 tests, typecheck, lint and `next build` green. `git diff v1.0` touches no v1 app code beyond Phase 1's approved files; `lib/parade/` is unchanged; migration 0004 only adds `wb_` objects.
- Locally (flag on, throwaway token, `sabre_dev`) on a 375px viewport: AL across Deepavali (8 and 9 Nov pre-unticked, 2 days charged) → "Saved, but PLATOON 6 has no commanders chat yet" → Approvals → Approve (balance 14 → 12) → Undo (back to pending, balance back) → Reject with a reason → Add for several men (2 picked, IPPT 0800–1200) → Home shows it under Next → Gaps "Your platoon only", collapsed by platoon.
- On the user's phone with the real bot (2026-10-12): cards in the test group's topic, Approve/Undo/Say why there, DMs, and a card's Open landing on the record whether or not the Mini App was already signed in.

**Verified 2026-10-12 (Phase 3), not yet on a phone:**
- 276 tests, typecheck, lint and `next build` green. Since `v1.0` the only v1 file changed this phase is `vercel.json` (the approved cron); `lib/parade/` is untouched; 0005 only adds `wb_` objects (the guard passes).
- Locally on a 375px viewport (flag on, throwaway token, `sabre_dev`): Report sick (RSO) → Approvals → Approve → My records shows Update outcome → the outcome form (ONENS asked for the RSO, statuses 1–4) → the photo upload's error path (the throwaway token can't reach Telegram) → an outcome inserted by SQL shows on the record page with the diagnosis, a lock note and Correct; Correct pre-fills; ONENS owed → "Checked" clears it. Signed in as the camp's GC: the photo route 404s, the page shows nothing, no `read-medical` rows.

**Test on the phone (Phase 3), on the preview with made-up data only:**
1. `/sick` in the DM → Report sick → Outside (RSO), today, a clinic, symptoms → the card in the test topic shows the symptoms.
2. Approve on the card → your DM gets "Go now…" with **💊 Update outcome**.
3. Tap it → MC yes, status yes → Respiratory, a made-up diagnosis, 3 days → 1 status, LIGHT DUTY → take a photo of any paper → ONENS "Not yet" → Record it. Your DM gets the photo copy and "✅ Recorded"; the topic gets "📝 Outcome recorded" with **no diagnosis and no photo**.
4. Open the record: the diagnosis (🔒) and the photo show. Correct → change the last day, keep the photo → the topic gets "✏️ Outcome corrected" with Replaces, and the old card ends "🚫 Corrected by …".
5. Home → ONENS owed → it's listed.
6. `npm run wb:setup -- evening` → your DM gets the ONENS reminder (tap ☁️ Uploaded), the 💓 heartbeat, and anything else due.
7. Optional: void the RSO from Person history → its MC and status go with it.
8. Optional, if you can borrow a second account with only a GC grant: Open from the card says it isn't theirs.

**Gotchas (Phases 1–3):**
- Never add `diagnosis` or `evidence_file_id` to a select that feeds a `RecordView`, a card or a DM. Read them only through `lib/wb/medical.ts`.
- An outcome's rows are tied by one `created_at` (set in JS, inserted in one statement). Don't insert outcome rows one at a time.
- Vercel crons only fire on **production** deployments. On the preview, run the round with `npm run wb:setup -- evening`.
- `JSON.stringify` on a captured `sendPhoto` payload throws (grammY's `InputFile`); filter those calls out in tests.
- `notFound()` inside `run()` is swallowed into "Something went wrong", so server actions call `requireFeature()` **before** `return run(…)`. The guard test checks this pattern (and its regex needs the parameter list without parentheses inside it).
- `"use server"` files may export only async functions (types are fine): constants such as `TAKEN_MESSAGE` and `NOT_ON_ROSTER` live in `lib/wb/domain/*`.
- Client components must not import `lib/wb/db/schema.ts` (it pulls Drizzle into the bundle). Shared vocabularies go in `lib/wb/domain/*`.
- Don't use `PageProps`/`LayoutProps` for `/tg` routes: `tsc` only knows routes after `next typegen`. Dynamic params are `params: Promise<{ id: string }>`.
- The Sheets re-import (`npm run import`) deletes and recreates every `person`. That unlinks every member, drops camp/platoon grants and now **deletes every `wb_record`** (cascade). See §6.
- In tests, `vi.mock` factories are hoisted: shared state goes through `vi.hoisted`, and grammY's `Api` is built inside the factory (see `records.db.test.ts`).
- A `force_reply` is only "selective" for users mentioned in the text, so the Say why prompt carries a `text_mention` entity for the decider.

### 3b. Next phase: Phase 4 (Shifts and forecast: patterns, HOTO, minimum manning, forecast grid, manning on cards)
**Before building, settle with the user** the §6 questions marked *(Phase 4)*: each paired camp's cycle and anchor, the minimum manning per camp, and the rest. Also confirm Phase 3 was checked on the phone (§3a checklist).

**Goal:** Sabre knows which team of each physical camp is on shift on any day, from a fixed cycle that a HOTO confirms or re-anchors; it knows each guardroom's minimum manning per role; and from that and the timeline it shows a commander how thin a camp will be. Approval cards (leave, off, report sick) say what approving does to the camp on its worst day, and a forecast grid shows camps × the next 14 days. **Still nothing reaches the parade state** (`FEATURE_PROJECTION` stays off): a HOTO in the Mini App does **not** flip v1 `camp.on_shift` yet (that's Phase 6).

**Build:**
1. **Schema** (migration 0006, `wb_` only):
   - `wb_shift_pattern`: `camp_id` (unique, FK `camp`), `kind` (`wb_shift_kind`: `CYCLE`, `WEEKLY`, `ALWAYS`), `on_days`/`off_days` (int, CYCLE), `anchor_date` (date: the first day this team is on, CYCLE), `hoto_time` (HHMM, when the day flips), `weekday_mask` (int bits Mon..Sun, WEEKLY; RG camps are 5-in-2-out = Mon–Fri), `both_on_allowed` (bool, SRF), `updated_by`, `updated_at`.
   - `wb_shift_event`: `camp_id`, `at` (timestamptz), `on` (bool: this team took over / handed over), `by` (member), `matched` (bool: did it agree with the pattern), `note`.
   - `wb_min_manning`: `camp_id` (unique), `gc`, `st_cbt`, `st_svc` (int), `updated_by`, `updated_at`. Parsed from and shown as `1:4:3` (Sabre Bot's `parse_minimum`; a bare number = a total with no breakdown).
2. **Pure domain** (`lib/wb/domain/shifts.ts`, `forecast.ts`):
   - `onShiftAt(pattern, events, t)`: CYCLE counts whole cycles from the anchor (after the latest re-anchoring HOTO) with the day flipping at `hoto_time`; WEEKLY reads the mask in SGT; ALWAYS is on. A pair (`camp.post`, e.g. SFT A + SFT B) must have exactly one team on unless `both_on_allowed`.
   - `hotoEffect(pattern, event)`: matches → confirmation; doesn't → a new anchor so that this team is on from `at` (and the PS is alerted).
   - `parseMinimum("1:4:3")`/`minimumLabel`, `roleCounts(people)` using `roleOf` (ROLE_ALIASES), `gaps(minimum, counts, unknown)` (Sabre Bot's `Minimum.gaps`: a person with no role makes per-role claims a guess, so fall back to the total).
   - `snapshotAt(t, base)`: builds a v1 `CoySnapshot` for a future instant from the roster, projected shifts (`onShiftAt`) and the timeline (absent `APPROVED`/`RECORDED` records, plus optionally `PENDING` ones) and runs it through the **unchanged** `computeCoy` (`lib/parade/compute.ts`). Phase 4 reads v1 open duties as they are; `wb_assignment` arrives in Phase 5.
   - `worstDay(camp, days, …)`: per day, present by role vs the minimum; the worst day decides (port `engine._manning`, which counts the requester out because his row is already PENDING).
3. **Mini App:**
   - **Shifts admin** (ADMIN, or PC/PS for their platoon's camps): set each camp's pattern and minimum manning.
   - **HOTO** (GC of the camp, PC/PS, OC/2IC/CSM): "Handed over" / "Took over" logs a `wb_shift_event`; a mismatch re-anchors and posts a line to the platoon's commanders chat.
   - **Forecast grid** (PC/PS: their platoon; OC/2IC/CSM: company): camps × the next 14 days, each cell `0:4:3 / min 1:4:3`, red below minimum, striped when it's only short because of pending requests; tap a cell for the day (who's away and why, from `RecordView`, never a diagnosis).
   - **Today / Day** for a platoon: who's on shift where, who's away (kind + dates), who's on status.
4. **Cards:** the approval card for AL/OL/OFF/RSI/RSO gains a manning line: "SLR on 14/10 (worst day): 0:3:3 / min 1:4:3 — BELOW MINIMUM", with the requester counted out; "No minimum manning set for SLR" when there isn't one; nothing for COY HQ. Cards are re-drawn on decide as now (the line is recomputed).
5. **Evening round:** add "tomorrow below minimum" per platoon to the digest (one line per camp short), still once a day.

**Tests (Vitest):**
- Shifts: CYCLE across many cycles and a HOTO time, a re-anchor, WEEKLY across a weekend and a public holiday (public holidays don't change shifts unless the user says so: §6), ALWAYS, pairs never both off, `both_on_allowed`.
- Minimum: `parseMinimum` (incl. a bare number and junk), `gaps` with and without unknown roles.
- `snapshotAt(now)` with today's real patterns gives the same `computeCoy` result as `loadSnapshot` (parity check on the fixture), and a future day with an approved AL counts that person out.
- Cards: the manning line, worst day across a range, requester counted out, no-minimum wording.
- DB: HOTO confirm vs re-anchor and its alert; forecast grid scope (a PS sees his platoon only).
- **Still: all v1 tests green, `lib/parade/` untouched, no v1 table altered, `camp.on_shift` never written.**

**Done when:**
- `npm test`, `npm run typecheck`, `npm run lint` and `next build` are green.
- With flags off, the app behaves exactly like `v1.0`.
- On the preview: set SFT's cycle and SLR's minimum → apply for AL on a short day → the card says BELOW MINIMUM → the forecast grid shows the red cell → a HOTO on the wrong day re-anchors and alerts the topic.

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
| 2026-10-12 | Phase 3 answers: the photo is uploaded **in the Mini App** (shrunk on the phone, sent to the trooper's own DM, only the `file_id` kept); the evening round gets a **`vercel.json` cron** (approved); **RSI and RSO both need PC/PS approval and the card shows the symptoms**; **ONENS: the trooper taps Uploaded** (his PC/PS and OC/2IC/CSM can clear it too from ONENS owed) |
| 2026-10-12 | S6 hasn't signed off: Phase 3 is built and tested with made-up medical data only |
| 2026-10-12 | An RSO is **absent for the day** (the plan), unlike Sabre Bot, which never counted a report sick as absent. When projection arrives (Phase 6) an MC outranks it, so nobody is counted twice |
| 2026-10-12 | **Correct** an outcome (as Sabre Bot had): recording again cancels the old rows ("Corrected by X") and posts "✏️ Outcome corrected" with what it replaces. A standalone outcome can be corrected but not removed (the PS voids it) |
| 2026-10-12 | An MA's outcome asks **who he saw** (MO or civilian), like a standalone MC: MAs are usually at civilian hospitals, and Sabre Bot never asked, so their MCs were never chased for ONENS |
| 2026-10-12 | The photo is **required** when an MC or status is recorded (as Sabre Bot); a correction can keep the earlier one. One photo for the whole outcome, stored on each of its rows |
| 2026-10-12 | Medical reads are audited **per value shown**: a page showing a diagnosis writes one `read-medical` row, and each photo request writes one. A GC, another platoon's PS, an ASA or an ADMIN gets nothing and nothing is logged |
| 2026-10-12 | The photo upload is a **route handler**, not a server action: actions are capped at 1 MB and raising that means editing v1's `next.config.ts` |
| 2026-10-12 | Undo is refused once an outcome hangs off the approval; the commander voids instead (the void takes the outcome with it) |
| 2026-10-12 | The evening round's outcome chase stops 14 days after approval; "nothing given" counts as an answer |

---

## 6. Open questions
- Sabre Bot's token is in plaintext in `sabre-bot/temp.txt`. Rotate it or delete the file. Don't reuse it.
- The preview branch's `neondb_owner` password is the same as production's and was pasted into a chat on 2026-10-12: reset it on both branches when convenient (production needs its Vercel `DATABASE_URL`/`POSTGRES_*` updated).
- `setChatMenuButton` returns ok but `getChatMenuButton` still reports `commands`; if the ☰ button doesn't open Sabre, set it in BotFather (Bot Settings › Menu Button).
- Is Vercel's `TELEGRAM_BOT_TOKEN` (production) still the old parade-state bot? Locally it had been set to @sabreopsbot. If production has it too, the v1 Send button posts as @sabreopsbot.
- **Sheets re-import vs whereabouts.** `npm run import` deletes and recreates every `person`, which would unlink every member, drop platoon/camp-scoped grants, and (since Phase 2) **delete every `wb_record`** through the cascade. Before whereabouts goes live, either stop re-importing (the STATUS.md cutover plan) or make the import update people in place. Changing the import touches v1, so it needs the user's go-ahead.
- A PS or PC can approve **their own** request (allowed for now so the user can test alone with one account). Should a commander's own request go to another commander, e.g. the PC for the PS and OC/2IC for the PC?
- Add MOM's 2028 public holidays to `lib/wb/domain/holidays.ts` when they're published (mid-2027).
- **S6's position** on storing diagnoses and document photos. Until they sign off, Phase 3 holds test data only (the gate for turning it on with real people).
- A trooper who has **never pressed Start** in the bot's DM can't get the photo copy, so the upload fails with "Open that chat, tap Start, then try again". Opening the Mini App from the bot normally means he has; worth watching on the phone test.
- The evening round on production will hit a 404 each evening while `FEATURE_WHEREABOUTS` is off there. Harmless (one log line); add `CRON_SECRET` on Production before switching it on.
- *(Phase 4)* Each paired camp's cycle: on/off days (3-in-3-out everywhere?), the anchor date (a day team A was on), and the HOTO time. Which camps are RG 5-in-2-out (Mon–Fri) and does a public holiday change that?
- *(Phase 4)* Minimum manning per camp, in `GC:ST CBT:ST SVC` form (e.g. `1:4:3`). Who may change it: ADMIN only, or the platoon's PC/PS too?
- *(Phase 4)* Should a HOTO in the Mini App replace the v1 shift toggle later (Phase 6), and who may log one: the camp's GC, or PC/PS only?
- *(Phase 4)* Forecast: count pending requests as away (pessimistic) or show them striped only?
