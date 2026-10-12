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
| 3 | Medical: RSI/RSO → MC/HL/status outcomes, ONENS, evening round | ✅ Done 2026-10-12 (958b4a4…a382f5c, pushed), migration 0005 on the preview branch. Verified on the user's phone (the user, 2026-10-12). Medical data cleared for real use (no S6 involved) |
| 3½ | UI/UX pass on the Mini App (not a phase): current-only records + Full history, restyle, motion, skeletons | ✅ Done 2026-10-12 (aa3949f…61513ca, pushed). Verified on the user's phone (the user, 2026-10-12) |
| 4 | Shifts + forecast: patterns, HOTO, min manning, forecast grid, impact on cards | 🧪 Built and pushed 2026-10-12 (5f0ec8d…2ae2cd1); preview built, commands re-registered. Migration 0006 and the agreed patterns/minimums (`scripts/wb-seed-shifts.ts`) are on the preview branch. **Waiting for the user's phone check** (checklist in §3a) |
| 5 | RF requests + deploy | ⏳ Next. Spec in §3b |
| 6 | Projection into the parade state (shadow diff first) | — |
| 7 | Transport claims | — |

**Prerequisites from the user** (tick off as they arrive):
- [x] A bot made with @BotFather: **@sabreopsbot** (confirmed by the user 2026-10-12).
- [x] `WB_BOT_TOKEN` in `.env.local` and on Vercel Preview (branch `whereabouts`), 2026-10-12. The user puts it there; it's never pasted into chat. @sabreopsbot's token was in `.env.local` under `TELEGRAM_BOT_TOKEN`; rename that line to `WB_BOT_TOKEN`, and put the **old parade-state bot's** token back as `TELEGRAM_BOT_TOKEN` (the v1 Send button uses it).
- [x] `WB_WEBHOOK_SECRET` (`openssl rand -hex 32`), `WB_ADMIN_TELEGRAM_IDS` (your id from `/whoami`) and `WB_APP_URL`, in `.env.local` and on the Vercel preview. See `.env.example`.
- [x] In @BotFather: `/newapp` for @sabreopsbot, title **Sabre**, short name **`app`** (the code builds `t.me/sabreopsbot/app`), URL `<WB_APP_URL>/tg` (fixed 2026-10-12: it had been the bare preview address, so a card's **Open** landed on the v1 sign-in). Privacy mode stays **on** (the default).
- [x] A test Telegram group with the user in it (linked with `/here`, 2026-10-12). Approval cards go there during development.
- [ ] `CRON_SECRET` (`openssl rand -hex 32`) on Vercel **Production** before whereabouts is switched on there: Vercel sends it to the evening-round cron. Not needed on the preview (Vercel crons only run on production; run the round by hand with `npm run wb:setup -- evening`).
- [x] A Neon branch database for previews (free): branch `whereabouts`, migrated to 0003, set as the Preview `DATABASE_URL` for branch `whereabouts` with its own `AUTH_SECRET`; preview protection off; webhook set (2026-10-12). Old note: **As of 2026-10-12 Vercel's Preview environment shares Production's `DATABASE_URL`** (same variables for both) and has no `AUTH_SECRET`/`APP_PASSWORD`, and preview deployments sit behind Vercel Authentication. Give the `whereabouts` branch its own Preview `DATABASE_URL` and `AUTH_SECRET`, and turn preview protection off, before testing with Telegram. Local development uses `sabre_dev`/`sabre_test` as for v1. Apply migration `0003_wb_foundation` to it (`DATABASE_URL=<branch url> npx drizzle-kit migrate`).

---

## 3. Handover

### 3a. What exists now (Phases 1–4)
**Preview environment (set up 2026-10-12; use it for every phase):**
| | |
|---|---|
| URL | `https://sabre-git-whereabouts-ning-8b5f.vercel.app` (stable alias for the latest `whereabouts` build). Mini App at `/tg`. Vercel Authentication is **off** for previews |
| Vercel env | Preview, branch `whereabouts` only: `DATABASE_URL` (Neon branch), `AUTH_SECRET`, `FEATURE_WHEREABOUTS=1`, `WB_BOT_TOKEN`, `WB_WEBHOOK_SECRET`, `WB_APP_URL`, `WB_ADMIN_TELEGRAM_IDS`. No `TELEGRAM_BOT_TOKEN`, so a preview can't send a parade state. Production has none of the `WB_*`/`FEATURE_*` variables |
| Database | Neon branch `whereabouts` (copy of production taken 2026-10-12: real roster, 214 active people), migrated to **0006** on 2026-10-12 and seeded with the agreed shift patterns and minimums (`scripts/wb-seed-shifts.ts`). Its unpooled URL is `WB_PREVIEW_DATABASE_URL` in `.env.local`. **Apply each new migration to it before pushing:** `DATABASE_URL="$WB_PREVIEW_DATABASE_URL" npx drizzle-kit migrate`. `.env.local` isn't shell-sourceable (line 15), so load it with dotenv in a `node -e` script, and check the host starts with `ep-dawn-field` (production is `ep-green-base`) |
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
| Pure domain (Phase 3) | `rules.ts`: RSI/RSO in `APPROVAL_KINDS`; `isAbsentKind` (RSI, RSO and STATUS no; MC, HL yes), `VISIT_KINDS`/`OUTCOME_KINDS`, `outcomeParentRefusal`, `onensFor` (owed only for a civilian MC: under an RSO, or `seen_by = CIVILIAN` when standalone or under an MA), `asksSeenBy`, `kinOf` (void cascade), `canSeeMedical` (owner or `canDecide`), `MAX_STATUSES`. `roles.ts`: `MC_CATEGORIES`, `STATUSES`. `describe.ts`: `recordWhat` for RSI/RSO/MC/HL/STATUS ("MC 3 days · 14/10–16/10 · Respiratory", never the diagnosis), `mcCategoryOf`, `statusLabel` |
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
| Current vs history (UI pass) | `lib/wb/domain/rules.ts`: `isCurrent(record, liveChildren, now)` (pending; standing and not over, open-ended included; still owing an outcome (`awaitsOutcome`) or ONENS, itself or through a child; rejected within `REJECTED_SHOWN_MS` = 7 days and not over), `nestOutcomes` (My records' grouping, moved out of the page), `liveChildren` (Person history, flat). My records and Person history show current by default; `?all=1` (server-rendered, so Back works) is Full history, dead records greyed. `HistoryToggle` (`components/tg/history-toggle.tsx`) is the "Full history (n)" / "Current only" link. `recordsOfPerson` now reads up to 500 so an old permanent status isn't cut off. Tests: `tests/wb/current.test.ts` |
| Look and motion (UI pass) | `app/(tg)/tg/miniapp.css`, scoped under `.tg-app` (TgShell): the page is Telegram's secondary background, cards the section background (`--tg-page`; plain-browser fallbacks for light/dark); `.tg-rows` hairlines; focus rings; motion classes `tg-enter` (stagger via `--i`, capped), `tg-reveal`, `tg-pop`, `tg-press`, `tg-skeleton`, all inside `prefers-reduced-motion: no-preference`, transform/opacity only, 120–260 ms ease-out. TgShell sets Telegram's header/background colour to `secondary_bg_color` (6.1+). `components/tg/ui.tsx` (server-safe): `Group` (titled group, `rows`), `EmptyState`, `Bone`/`CardBone`/`PageBone`, `enter(i)`, and the class strings `inputClass`/`fieldClass`/`textareaClass`/`bigButtonClass` (48 px). `form-bits.tsx` adds `StepBar` (Step n of m + Back, leave and Add for several men), `Step` (numbered section: report sick, outcome form), `DoneScreen`/`BigLink` (one Done screen; `Done` takes a `note`); `Choice` ticks `HapticFeedback.selectionChanged` when the answer changes. State chips have an icon each; the Mini App uses lucide icons, no emoji (the bot's cards keep theirs) |
| Skeletons (UI pass) | `loading.tsx` in `/tg` (Home and anything without its own), `records`, `records/[id]`, `approvals`, `onens`, `people`, `people/[id]`, `gaps`. Static, and each returns `null` unless `isEnabled("WHEREABOUTS")`: Next serialises a loading fallback into the RSC payload even when the layout 404s. `flags.test.ts` checks both |
| Shifts (Phase 4) | Migration 0006 (`drizzle/0006_wb_shifts.sql`): `wb_shift_pattern` (per team: `kind` CYCLE/WEEKLY/ALWAYS, `on_days`/`off_days`, `anchor_date` + `hoto_time` (the day a stint starts, at that time), `weekday_mask` (bit 0 = Mon), `holidays_off`, `both_on_allowed`), `wb_shift_event` (the HOTO log: `on`, `at`, `by`, `matched`), `wb_min_manning` (per team: `total`, and `gc`/`st_cbt`/`st_svc`, all null for a bare number). All cascade on camp delete (v1's import keeps camps by id, so they survive a re-import) |
| Shift rules (pure) | `lib/wb/domain/shifts.ts`: `onShiftAt(p, t)` (instant), `onDuring(p, range)`/`onDay` (**any moment of the day**: a 2100 flip makes both teams "on" on the handover day, so SFT B mounting 10/10 2100 stands 10–13/10), `stintAround`, `partnerPattern` (the other team = anchor + on days), `pairProblem` (exactly one team on at every instant, or at least one with both-on), `hotoEffect` (within `HOTO_TOLERANCE_MS` = 6 h of the expected flip: confirmed; otherwise the new anchor so this team's stint starts (took over) or ends (handed over) at the HOTO time nearest the log), `parseMinimum`/`minimumLabel`/`strengthOf` (via `roleOf`)/`strengthLabel`/`gaps` (Sabre Bot's: any unknown role falls back to the total). Permissions in `rules.ts`: `canEditShifts` (ADMIN, or the platoon's PC/PS), `canHoto` (GC of either team, the platoon's PC/PS, OC/2IC/CSM), `canForecast` (= `canDecide`) |
| Forecast (pure) | `lib/wb/domain/forecast.ts`: `snapshotFor(input, window, { pending, assume })` builds a v1 `CoySnapshot` from **the roster (camps, people, roles), the patterns and the timeline only**: shifts from the patterns (a camp without one keeps its v1 `onShift`); a person is away if a live absent timeline row covers the window. **The parade state's own absences and Extra/RF/SOL are never read** (decided 2026-10-12, §5); assignments arrive in Phase 5. `manningOf` runs it through the **unchanged** `computeCoy`: per camp, heads by role (sent-in Extra/RF/SOL included), who's away (`what`, `dates`, `recordId`, `pending`). `forecastGrid` (camps × days, `short` on approved, `pendingShort`/`pendingLabel`), `worstDay` (the requester counted out with `assume`; days the camp is off don't count; most short, then fewest heads), `manningLine` |
| Forecast reads | `lib/wb/forecast-data.ts` (no decide import, so `decide.ts` can use it): `campsInfo`, `postsOf`, `loadPatterns`, `loadMinimums`, `forecastInput(range, campIds)` (the v1 snapshot of **the coy that owns those camps**, via `loadSnapshot`), `manningFor(record)` (the card's line; never throws), `forecastScope`, `grid`, `dayView` (strength on approved, away list with pending flagged, statuses), `shiftNote`, `patternSummary`, `shortTomorrow` |
| Shift writes | `lib/wb/shifts.ts`: `saveShift` (one physical camp at once: both teams of a pair, the other team derived; refuses a half pair, a pair whose on ≠ off, a `pairProblem`, a bad minimum, another platoon; audited `shift-pattern`), `logHoto` (refuses non-CYCLE camps, the future (> 15 min), more than 2 days back; logs `wb_shift_event`; on a mismatch moves this team's anchor and its partner's, audits `hoto-reanchor`, and posts "🔄 HOTO off the pattern" to the platoon's commanders chat). **Never writes v1 `camp.on_shift`** |
| Cards and digest (Phase 4) | `cardText(r, manning)` adds the line between the body and the decision ("⚠️" when BELOW MINIMUM, else "👥"); `sendCard` and `refreshCards` compute it with `manningFor` for AL/OL/OFF/RSI/RSO while PENDING or APPROVED (an RSI/RSO says "if he's given an MC"; COY HQ gets none; "No minimum manning set for X"; "X is off shift for all of it"; "(+n pending would make it …)"). The evening round adds "⚠️ Below minimum tomorrow" per platoon (approved records only) and counts it in the heartbeat |
| Mini App (Phase 4) | `shifts` (list) and `shifts/[campId]` (`components/tg/shifts/shift-form.tsx`), `hoto` (`hoto-panel.tsx`: who took over, day, time, recent HOTOs), `forecast` (sticky camp column, 14 scrollable days, `tg-stripes`/`tg-grid-sticky` in `miniapp.css`), `day/[date]` (`?camp=` narrows; Day before/after). Home tiles Today, Forecast, HOTO (commanders) and Shifts (settings). Bot: `/hoto` quick command |
| Seed | `scripts/wb-seed-shifts.ts` (`DATABASE_URL=… npx tsx scripts/wb-seed-shifts.ts [--replace]`): the agreed patterns and minimums by camp name; refuses `ep-green-base` (production) without `--production`. Run on the preview 2026-10-12 |
| Tests | Phase 4: `shifts.test.ts` (cycles across many periods, the 2100 flip, four days per stint, pairs never empty/doubled, SRF weekly with both on the changeover Monday, RG in SGT incl. a public holiday, HOTO confirm/late/early/no anchor, minimums), `forecast.test.ts` (today's patterns match v1's toggles on the fixture; **the fixture's v1 absences and duties are never counted, today or later**; AL/pending/RSO/dead rows, events, the grid's red and striped, worst day, the card line wording), `shifts.db.test.ts` (saving and refusals, HOTO confirm vs re-anchor with the alert text and v1 `on_shift` unchanged, the card's BELOW MINIMUM and its redraw, the pending note, forecast scope for a PS, the evening digest). Phase 3: `medical-rules.test.ts` (approval/absence, outcome parents, ONENS, void cascade, `canSeeMedical` matrix, card lines); `records.db.test.ts` "medical (DB)" (RSO → card with symptoms → approve → outcome with MC + 2 statuses + photo; diagnosis never in any Telegram payload; who sees the diagnosis/photo and the audit rows; standalone + correction keeping the photo; refusals incl. a borrowed token; nothing given; void cascade; ONENS); `bot.db.test.ts` (evening round once a day, digest, heartbeat, the ONENS tap, `/sick`); `flags.test.ts` covers the three new routes and `CRON_SECRET`. The fake Telegram now answers `sendPhoto` and `getFile`. Phases 1–2: `tests/wb/`: unit (auth, registration, links, commands, migrations, `timeline`, `rules` incl. clash/describe/holidays/accessTo), DB (`*.db.test.ts` on `sabre_test`, with `next/headers` mocked by a cookie jar): `records.db.test.ts` (full lifecycle, races, void, withdraw, proxy, scope, checks) and `bot.db.test.ts` (fake Telegram: cards, alerts, undo window, Say why, quick commands), and `flags.test.ts` (the guard test) |

**Verified 2026-10-12 (Phase 2):**
- 217 tests, typecheck, lint and `next build` green. `git diff v1.0` touches no v1 app code beyond Phase 1's approved files; `lib/parade/` is unchanged; migration 0004 only adds `wb_` objects.
- Locally (flag on, throwaway token, `sabre_dev`) on a 375px viewport: AL across Deepavali (8 and 9 Nov pre-unticked, 2 days charged) → "Saved, but PLATOON 6 has no commanders chat yet" → Approvals → Approve (balance 14 → 12) → Undo (back to pending, balance back) → Reject with a reason → Add for several men (2 picked, IPPT 0800–1200) → Home shows it under Next → Gaps "Your platoon only", collapsed by platoon.
- On the user's phone with the real bot (2026-10-12): cards in the test group's topic, Approve/Undo/Say why there, DMs, and a card's Open landing on the record whether or not the Mini App was already signed in.

**Verified 2026-10-12 (Phase 3), not yet on a phone:**
- 276 tests, typecheck, lint and `next build` green. Since `v1.0` the only v1 file changed this phase is `vercel.json` (the approved cron); `lib/parade/` is untouched; 0005 only adds `wb_` objects (the guard passes).
- Locally on a 375px viewport (flag on, throwaway token, `sabre_dev`): Report sick (RSO) → Approvals → Approve → My records shows Update outcome → the outcome form (ONENS asked for the RSO, statuses 1–4) → the photo upload's error path (the throwaway token can't reach Telegram) → an outcome inserted by SQL shows on the record page with the diagnosis, a lock note and Correct; Correct pre-fills; ONENS owed → "Checked" clears it. Signed in as the camp's GC: the photo route 404s, the page shows nothing, no `read-medical` rows.

**Test on the phone (Phase 3), on the preview:**
1. `/sick` in the DM → Report sick → Outside (RSO), today, a clinic, symptoms → the card in the test topic shows the symptoms.
2. Approve on the card → your DM gets "Go now…" with **💊 Update outcome**.
3. Tap it → MC yes, status yes → Respiratory, a made-up diagnosis, 3 days → 1 status, LIGHT DUTY → take a photo of any paper → ONENS "Not yet" → Record it. Your DM gets the photo copy and "✅ Recorded"; the topic gets "📝 Outcome recorded" with **no diagnosis and no photo**.
4. Open the record: the diagnosis (🔒) and the photo show. Correct → change the last day, keep the photo → the topic gets "✏️ Outcome corrected" with Replaces, and the old card ends "🚫 Corrected by …".
5. Home → ONENS owed → it's listed.
6. `npm run wb:setup -- evening` → your DM gets the ONENS reminder (tap ☁️ Uploaded), the 💓 heartbeat, and anything else due.
7. Optional: void the RSO from Person history → its MC and status go with it.
8. Optional, if you can borrow a second account with only a GC grant: Open from the card says it isn't theirs.

**Verified 2026-10-12 (UI pass), not yet on a phone:**
- 318 tests, typecheck, lint and `next build` green at each commit. The diff since a382f5c touches only `app/(tg)`, `components/tg`, `lib/wb` and `tests/wb`: no v1 file, no `components/ui`, no `globals.css`, no migration, nothing in `lib/parade/`.
- Flag off (`next start` of the build, no `FEATURE_WHEREABOUTS`): `/tg`, `/tg/records`, `?all=1`, Approvals and Person history are 404 with no skeleton anywhere in the response; v1 `/login` is 200.
- Locally (flag on, throwaway token, `sabre_dev`) with 15 seeded records (pending, approved-and-current, ended, withdrawn, voided, rejected 3 and 20 days ago, a corrected outcome, ONENS owed, an MA with no outcome, a permanent status): My records shows 8 of 13, Full history all 13, Back returns to current; Person history 11 of 18 (flat). Answering "nothing given" on the old MA drops it from current.
- A script swept every /tg screen at 375 px (Telegram light and dark via the `#tgWebAppThemeParams` hash, and a plain browser light/dark): no tap target under 44 px, no input under 16 px, no horizontal scroll, no page errors; it also walked AL's four steps with Back, the Reject panel, Add for several men's second step and the outcome form's Done. With reduced motion on, `.tg-enter` has no animation.

**Test on the phone (UI pass), on the preview after push:**
1. Home in Telegram light, then switch Telegram to dark: the page is the grey/black Telegram background with white/grey cards, and Telegram's own header matches it.
2. My records shows only what's current; scroll to the bottom → **Full history (n)** → everything, dead records greyed and struck through → Telegram's Back → current again.
3. Apply → Annual leave: the step bar reads Step 1 of 4 and fills; on step 3 tap **Back**, your answers are kept; send it → the Done screen's tick.
4. Report sick: three numbered steps; the next ones appear as you answer. Tapping a choice gives a light haptic tick.
5. An approved report sick → Update outcome: numbered sections open as you answer Yes/No.
6. Approvals → Reject: the reason box slides in; Approve/Reject show a spinner while saving.
7. Tap between screens quickly: a grey skeleton shows at once, not a blank page.
8. iPhone Settings › Accessibility › Motion › Reduce Motion on: nothing slides or fades, everything still works.

**Verified 2026-10-12 (Phase 4), not yet on a phone:**
- 365 tests, typecheck, lint and `next build` green. The only file outside `lib/wb`, `app/(tg)`, `components/tg`, `tests/wb` and `drizzle/` changed this phase is the new `scripts/wb-seed-shifts.ts`; `lib/parade/`, `lib/data/` and `lib/db/` are untouched; 0006 only adds `wb_` objects (the guard passes).
- Flag off (`next start`, no `FEATURE_WHEREABOUTS`): `/tg/shifts`, `/tg/shifts/<id>`, `/tg/hoto`, `/tg/forecast` and `/tg/day/<date>` are 404 and none of their markup is in the response; v1 `/login` is 200.
- Locally (flag on, throwaway token, `sabre_dev`) at 375 px: Home shows Today, Forecast, HOTO and Shifts; Shifts lists every camp; SRF's form refuses `1:2:4:1` with the message and saves 7 in 7 out with both-on; the forecast shows SRF A off 13–18/10, a red day from an approved Off and a striped day from a pending one; tapping the striped cell opens the Day with the pending Off flagged and the statuses listed; a HOTO for SRF B at 2041 confirms. No horizontal scroll, every tap target ≥ 44 px, no console errors.
- Preview database: 0006 applied and the patterns and minimums seeded (host checked as `ep-dawn-field`).

**Test on the phone (Phase 4), on the preview after push:**
1. Home → **Shifts**: every camp has a pattern; SFT reads "3 in 3 out · HOTO 2100" with SFT B on until 13/10 2100; SLR min 1:4:3; SRF's minimums are empty (flagged, §6).
2. Home → **Forecast**: PLATOON 6's SLR and SRF rows, 14 days; weekends grey for SLR. Tap a day → the Day view: who's away and why, nobody's diagnosis.
3. As a trooper (your own account is on SLR), apply for **Off** on a weekday → the card in the test topic has a 👥 line "SLR on dd/mm: … / min 1:4:3". Make it short: ask for a day when SLR is already thin, or temporarily set SLR's minimum to its full strength in Shifts → the card says ⚠️ … BELOW MINIMUM.
4. Approve it → the card is redrawn with the line still there; the Forecast shows that day red. A second pending Off on another day shows striped.
5. Home → **HOTO** (you're PS of PLATOON 6, so SRF shows): log "SRF A took over" at today's time → "The cycle has moved", and the test topic gets "🔄 HOTO off the pattern · SRF". Then put SRF back in Shifts (Team B took over 12/10/26 at 2100, 7 days on, both teams may stand).
6. `/hoto` in the bot DM → a button opens the HOTO screen.
7. `npm run wb:setup -- evening` → if a camp is short tomorrow, the digest says "⚠️ Below minimum tomorrow"; the heartbeat counts it.
8. The v1 web app's shift toggles haven't moved (a HOTO never changes the parade state until Phase 6).

**Gotchas (Phases 1–4):**
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
- Class strings shared by server and client components live in `components/tg/ui.tsx`, not `form-bits.tsx`: anything a `"use client"` file exports reaches a server component as a client reference, not a string.
- A `loading.tsx` under `/tg` must return `null` with the flag off and import only `components/tg/ui` and `lib/flags` (the guard test checks it).
- New Mini App styles go in `miniapp.css` under `.tg-app`, and any motion inside the `prefers-reduced-motion: no-preference` block.
- `decide.ts` imports `forecast-data.ts` (the card's line), and `shifts.ts` imports `decide.ts` (`inTx`, `Refusal`): keep reads in `forecast-data.ts` and writes in `shifts.ts`, or the two import each other.
- A pattern belongs to a **team** (a v1 camp); a pair is saved together and its second team is derived (`partnerPattern`). Don't save one team of a pair alone.
- "On" for a day means on at **any moment** of it (`onDuring`), so both teams of a pair count on a handover day. `onShiftAt` is the instant, used for the HOTO screen's "on until".
- The forecast never reads v1 `absence` or `duty` rows, only the roster. Don't add them back: they're typed by hand, often undated, and go stale (the preview copy had 24 undated and 24 overdue open absences on 12/10).
- A HOTO re-anchor rewrites the pattern, so a Day view of a date **before** the re-anchor follows the new cycle too. Only forward days are meant to be read.
- `campsInfo()` isn't scoped to one coy (local `sabre_dev` has two: `PL5-8 COY` and `SABRE`), so group and key by ids, never by names. Production has one coy.

### 3b. Next phase: Phase 5 (RF requests and deploy)
**Before building, settle with the user** the §6 questions marked *(Phase 5)*. Also confirm Phase 4 was checked on the phone (§3a checklist) and the SRF questions in §6.

**Goal:** a camp that will be short asks for manpower (RF) from the Mini App; the request reaches every commanders chat as a live card; a commander deploys a man from another camp, which creates an assignment that counts him at the camp that asked and away from his own, in the forecast, the cards' manning lines and the Day view. **Still nothing reaches the parade state** (`FEATURE_PROJECTION` stays off): v1 `duty`/`absence` rows are not written until Phase 6.

**Build:**
1. **Schema** (migration 0007, `wb_` only):
   - `wb_rf_request`: `camp_id` (where they're needed), `role` (`GC`/`ST CBT`/`ST SVC`/`ANY`), `need` (int), `start_at`/`end_at`, `reason`, `raised_by` (member), `state` (`wb_rf_state`: `OPEN`/`FILLED`/`CLOSED`), `closed_by`, `created_at`.
   - `wb_assignment`: `person_id`, `type` (`wb_assignment_type`: `EXTRA`/`RF`/`SOL`), `camp_id` (where he stands), `start_at`/`end_at`, `rf_request_id` (nullable), `state` (`ACTIVE`/`CANCELLED`), `created_by`, `created_at`. It says *where he stands*, not that he's away, so it's kept apart from `wb_record` (as Sabre Bot did).
   - `wb_card` is keyed to a record, so add `wb_rf_card` (`rf_request_id`, `chat_id`, `thread_id`, `message_id`) so every copy can be edited (Sabre Bot kept this in memory and lost it on restart).
2. **Pure domain** (`lib/wb/domain/rf.ts`): `shortBy(request, assignments)`, `rfCardText` (Sabre Bot's `_rf_card`: Camp, Duration, Manpower required, Reason, Manpower deployed, "Still short n of m" / FILLED / CLOSED, raised by), `rfKeyboard` (OPEN: Deploy someone + Close; the raiser's own copy: Close only), `canRaiseRf`/`canDeployRf` (per the §6 answers; Sabre Bot: GC and every HQ role for both), the deploy refusal rules (not his own camp; not already assigned then; not the last slot twice).
3. **Forecast:** `snapshotFor` takes live `wb_assignment` rows: an RF/Extra man counts at the camp he stands at (as a `SnapshotDuty` with his `personId`, so `servingCampId` places him and his role is read from the roster) and is away at home ("OTHERS: RF @ BDK"), exactly v1's `duties.ts` rule. SOL follows `servingCampId` (present at home while his team is on; under the on-shift team of the same post when it's off). Reuse, don't copy, `computeCoy`. A clash (he's on leave then) is a warning on the deploy screen, never a veto (Sabre Bot).
4. **Decision core** (`lib/wb/rf.ts`): `raiseRf` (posts a card to every linked commanders chat, plus the raiser's DM with Close), `deploy` (claims the slot with `UPDATE … WHERE state = 'OPEN'` and a count check in one transaction, so two commanders can't both fill the last slot; inserts the assignment; refreshes every card copy; DMs the man "RF @ X dd/mm–dd/mm, absent from Y", and posts a line to his own platoon's chat that it's a head down, with that camp's new manning line), `closeRf`, `undeploy` (cancels an assignment; reopens the request). Audit everything in `wb_audit`.
5. **Mini App:** **Raise RF** (camp: his own for a GC, any in scope for a commander; role; how many; from–to with times; reason), the **RF board** (open requests first, then filled/closed of the last 7 days; each with Deploy), **Deploy** (people in the deployer's scope not at that camp, filtered by role, each with his own camp's manning line for those days and any clash), and a request's page (the card's Open). Home tiles: RF board (badge = open requests), Raise RF. Bot: `/rf` quick command; card buttons `f:<id>:d|x` (Deploy opens the Mini App's deploy screen for that request; Close closes).
6. **Cards:** approval cards' manning line now counts assignments (a man deployed elsewhere is away at home; one sent in counts). The evening digest adds "🚌 n RF requests still open" per platoon.

**Tests (Vitest):**
- Pure: `shortBy`, card text and keyboards (own copy vs others), permissions, refusals.
- Forecast: an RF man counted at the camp he's sent to and away at home (parity with v1 when the same RF is a v1 duty), SOL both ways, Extra.
- DB: raise → card in every linked chat + the raiser's DM; deploy → assignment, every copy edited, "Still short 1 of 2", the man's DM and his platoon's line; the race for the last slot (one wins); close; undeploy reopens; the forecast and a card's manning line move.
- **Still: all v1 tests green, `lib/parade/` untouched, no v1 table altered, no v1 `duty`/`absence` written.**

**Done when:**
- `npm test`, `npm run typecheck`, `npm run lint` and `next build` are green.
- With flags off, the app behaves exactly like `v1.0`.
- On the preview: raise an RF for SLR → the card is in the test topic → Deploy a man from another camp → the card says FILLED (or still short) → the forecast shows SLR up a head and his home camp down one → Close a second request.

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
| 2026-10-12 | Full medical data like Sabre Bot (diagnosis + photo `file_id`). Originally gated on an S6 sign-off; there is no S6, and the user cleared it on 2026-10-12 |
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
| 2026-10-12 | Storing diagnoses and document photos is **cleared** (the user, 2026-10-12; there is no S6). Real medical data may go in once Phase 3 passes the phone check |
| 2026-10-12 | **Reporting sick is never an absence, RSI or RSO** (the user, overriding the plan): only the MC or HL that comes out of it takes him off. Same as Sabre Bot. RSI/RSO are never projected into the parade state |
| 2026-10-12 | **Correct** an outcome (as Sabre Bot had): recording again cancels the old rows ("Corrected by X") and posts "✏️ Outcome corrected" with what it replaces. A standalone outcome can be corrected but not removed (the PS voids it) |
| 2026-10-12 | An MA's outcome asks **who he saw** (MO or civilian), like a standalone MC: MAs are usually at civilian hospitals, and Sabre Bot never asked, so their MCs were never chased for ONENS |
| 2026-10-12 | The photo is **required** when an MC or status is recorded (as Sabre Bot); a correction can keep the earlier one. One photo for the whole outcome, stored on each of its rows |
| 2026-10-12 | Medical reads are audited **per value shown**: a page showing a diagnosis writes one `read-medical` row, and each photo request writes one. A GC, another platoon's PS, an ASA or an ADMIN gets nothing and nothing is logged |
| 2026-10-12 | The photo upload is a **route handler**, not a server action: actions are capped at 1 MB and raising that means editing v1's `next.config.ts` |
| 2026-10-12 | Undo is refused once an outcome hangs off the approval; the commander voids instead (the void takes the outcome with it) |
| 2026-10-12 | The evening round's outcome chase stops 14 days after approval; "nothing given" counts as an answer |
| 2026-10-12 | UI pass: **My records and Person history show what's current by default**, with **Full history (n)** (`?all=1`) at the bottom. Current = pending; approved/recorded and not over (open-ended counts); still owing an outcome or ONENS, itself or through a child. Withdrawn, voided, corrected and finished records are history. This replaces "withdrawn requests stay visible in My records" above: they're still there, greyed, in Full history |
| 2026-10-12 | **A rejected request stays in the current view for 7 days after the decision** (the user's answer), so the trooper sees it and the reason; earlier if its dates have already passed |
| 2026-10-12 | A report sick or MA with no outcome stays current until he answers (Update outcome, or "nothing given"), with no time limit, even after the evening round's chase gives up at 14 days |
| 2026-10-12 | Mini App look: Telegram's grouped-list style (secondary background page, section-colour cards), lucide icons instead of emoji in the Mini App (the bot's cards keep their emoji), CSS-only motion with tw-animate-css available and no animation library, all switched off for reduced motion |
| 2026-10-12 | Phase 4 answers: **SFT, OSU, PYAD run 3 in 3 out**, mounting at **2100** (the Sabre Coy calendar's "Team A/B Mount"); Team B mounted 10/10/26 2100. HOTO time is **per camp** (all 2100 for now) |
| 2026-10-12 | **SRF follows the calendar**: the teams swap 15NTM weekly on Monday, so 7 in 7 out, both teams standing on the changeover Monday, Team B on from 12/10/26, HOTO **2100 (not verified, §6)**. The user described SRF as "10 days in, 5 days out with a 1-day overlap", but the calendar shows a weekly swap, so the calendar was followed and the difference is flagged (§6) |
| 2026-10-12 | **RG camps (SLR, BDK, TFT, HDN, PRC) are Monday to Friday, public holidays off. COY HQ is Monday to Friday with no minimum** (it's left out of the forecast grid and gets no manning line; it shows in the Day view) |
| 2026-10-12 | **Minimum manning is per team**, `GC:ST CBT:ST SVC`: BDK, PRC, PYAD A/B, SLR, HDN 1:4:3; SFT A/B 1:4:8; TFT 1:0:2; OSU A/B 1:0:7. **SRF's "1:2:4" isn't in that form and is left unset** until it's explained (§6). Edited by **ADMIN and the platoon's PC/PS** |
| 2026-10-12 | **HOTO**: the camp's GC (either team of a pair), the platoon's PC/PS or OC/2IC/CSM, from the Mini App or `/hoto`. A HOTO within 6 hours of the expected flip confirms it; otherwise the cycle moves (both teams) and the commanders chat is told. **In Phase 6 the HOTO replaces the v1 shift toggle** |
| 2026-10-12 | **Pending requests**: the card's line counts approved records plus the request itself, and notes "(+n pending would make it …)". The grid is red when short on approved records, striped when only pending ones would make it short |
| 2026-10-12 | The forecast grid and the Day view are for **commanders only** (the platoon's PC/PS, OC/2IC/CSM company-wide), not GCs or ASAs |
| 2026-10-12 | A day counts as "on" for a team if it stands at **any moment** of it, so both teams of a pair are counted on a handover day (the user's "4 days" for a 3-day mount). A report sick's card line says what an MC would do ("if he's given an MC"), since reporting sick isn't an absence |
| 2026-10-12 | A pattern lives on each team, and a pair is always saved together (the other team derived from the first). Re-anchoring moves both. The forecast reads the v1 parade state of the coy that owns the camps |
| 2026-10-12 | **The forecast works only from what's keyed into the Mini App** (the timeline), plus the roster and the shift patterns. It no longer reads the parade state's own absences or Extra/RF/SOL (the user, after seeing expired and undated parade-state absences, e.g. "Clementi CO/RSM/OC Engagement", still counting against manning). This drops the earlier "snapshotAt(now) equals v1" parity: until troopers use the app, the forecast reads fuller than the parade state. The direction is the reverse: the parade state will be fed from the timeline (Phase 6) |

---

## 6. Open questions
- Sabre Bot's token is in plaintext in `sabre-bot/temp.txt`. Rotate it or delete the file. Don't reuse it.
- The preview branch's `neondb_owner` password is the same as production's and was pasted into a chat on 2026-10-12: reset it on both branches when convenient (production needs its Vercel `DATABASE_URL`/`POSTGRES_*` updated).
- `setChatMenuButton` returns ok but `getChatMenuButton` still reports `commands`; if the ☰ button doesn't open Sabre, set it in BotFather (Bot Settings › Menu Button).
- Is Vercel's `TELEGRAM_BOT_TOKEN` (production) still the old parade-state bot? Locally it had been set to @sabreopsbot. If production has it too, the v1 Send button posts as @sabreopsbot.
- **Sheets re-import vs whereabouts.** `npm run import` deletes and recreates every `person`, which would unlink every member, drop platoon/camp-scoped grants, and (since Phase 2) **delete every `wb_record`** through the cascade. Before whereabouts goes live, either stop re-importing (the STATUS.md cutover plan) or make the import update people in place. Changing the import touches v1, so it needs the user's go-ahead.
- A PS or PC can approve **their own** request (allowed for now so the user can test alone with one account). Should a commander's own request go to another commander, e.g. the PC for the PS and OC/2IC for the PC?
- Add MOM's 2028 public holidays to `lib/wb/domain/holidays.ts` when they're published (mid-2027).
- A trooper who has **never pressed Start** in the bot's DM can't get the photo copy, so the upload fails with "Open that chat, tap Start, then try again". Opening the Mini App from the bot normally means he has; worth watching on the phone test.
- The evening round on production will hit a 404 each evening while `FEATURE_WHEREABOUTS` is off there. Harmless (one log line); add `CRON_SECRET` on Production before switching it on.
- **SRF, to check with the user (flagged 2026-10-12):** (1) the user said SRF is "10 days in, 5 days out with a 1-day overlap during HOTO", but every month of the Sabre Coy calendar (Aug 2026–Jan 2027) shows SRF A and B swapping "15NTM" **weekly** on Mondays; the build follows the calendar (7 in 7 out). (2) In the calendar Team B's entry runs Monday to Monday (8 days) and Team A's Monday to Sunday (7), so only A's takeover overlaps. (3) The v1 parade state showed SRF A **and** B on shift on both 30/09 and 12/10, which a swap wouldn't. (4) The 2100 changeover time is a guess. (5) SRF's minimum "1:2:4" doesn't fit `GC:ST CBT:ST SVC` (SRF has no ST SVC on the roster); it's unset. Fix in Shifts once settled; nothing else needs changing.
- Does anyone switch RG camps (SLR, BDK, TFT, HDN, PRC) off in the v1 web app at weekends? The forecast says they're off on Saturday and Sunday; v1 shows whatever the toggle says until Phase 6.
- The plan's Phase 4 list (§7) also named a GC **Camp check** (expected people at CAA, tap only the differences). It wasn't in the Phase 4 spec and wasn't built. Is it still wanted, and in which phase?
- A HOTO re-anchor rewrites the pattern, so looking back at a day before it follows the new cycle. Fine for a forecast; if a history of who stood when is ever needed, read it from `wb_shift_event`.
- *(Phase 5)* Who may raise an RF: GC and every HQ role, as Sabre Bot (GC, OC, 2IC, SM, PC, PS, ASA)? Who may deploy: the same (Sabre Bot), or only PC/PS (from their own platoon) and OC/2IC/CSM?
- *(Phase 5)* Where do RF cards go: every platoon's commanders chat (Sabre Bot) and the COY HQ chat? Does the man deployed need to accept, or is he told (Sabre Bot: told)?
- *(Phase 5)* Should Extra and SOL also be entered in the Mini App in Phase 5 (Sabre Bot's `/assign`), or only RF through requests?
