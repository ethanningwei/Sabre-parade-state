# Sabre Whereabouts: a Telegram bot and Mini App on top of the parade-state app

> This is the **design**. For progress, the next phase's spec, ground rules, decisions and open questions, see [whereabouts-status.md](whereabouts-status.md).

## Context
Sabre coy (8SIR) has two standalone tools today:
- **The parade-state web app** (`~/Developer/Sabre`). It's live on Vercel/Neon, produces output identical to the old bot, and is about to be rolled out. GCs mark who is absent *now*.
- **Sabre Bot** (`~/Desktop/Claude Code/sabre-bot`, Python on Sheets). Troopers report sick and apply for leave, off and MA themselves, and commanders approve in their platoon chats. It was never consolidated with the app.

The goal is one system that knows **where every trooper is and will be**. That gives commanders whereabouts at a glance, and later, manning forecasts.

The chosen design (option 5):
- **Front ends:** a Telegram bot plus a Telegram Mini App, both on one Postgres database.
- **Location:** built inside the Sabre web app.
- **Hard constraint:** it must be possible to switch it off so the parade-state app runs alone and untouched. The parade state rolls out first, and nothing may put it at risk.

User decisions:
- Shifts follow a fixed cycle; a HOTO confirms it.
- Medical data is stored in full, as Sabre Bot does: diagnosis and a photo of the document.
- In scope: whereabouts, RF requests and deploy, and transport claims.

---

## 1. The kill switch: how the parade-state app stays safe
Yes, this is possible. Four rules guarantee it:

1. **Feature flags (env vars, all off by default):**
   - `FEATURE_WHEREABOUTS`: the bot webhook, Mini App routes, crons and nav entry. When off, every `/tg/*` and `/api/wb/*` route returns 404 and the crons do nothing.
   - `FEATURE_PROJECTION`: whether the timeline writes into the parade state's tables (§4). When off, whereabouts runs in **shadow mode**: troopers use it, but the parade state is computed exactly as today.
   - `FEATURE_CLAIMS`: transport claims.
2. **The database is additive only.** Every new table has a `wb_` prefix in its own schema file. There is **no ALTER on any v1 table**. Turning the flags off needs no rollback, and the tables can stay.
3. **v1 code is barely touched.** The only edits are:
   - adding a second schema path to `drizzle.config.ts`;
   - one flag-guarded nav link;
   - extracting the bodies of `saveDuty`, `endDuty` and `setStatus` (`lib/actions/duties.ts`, `lib/actions/attendance.ts`) into plain functions that the projector can call. This changes no behaviour and is covered by the existing tests.

   `lib/parade/` is **never edited**, so parity is untouched.
4. **Separate Telegram bot.**
   - The whereabouts bot gets its **own token** (`WB_BOT_TOKEN`, @sabreopsbot). That bot uses a webhook, which would break the old parade-state bot if it were polling the same token.
   - The parade-state send button keeps `TELEGRAM_BOT_TOKEN`.
   - Sabre Bot's token sits in plaintext in `temp.txt`. Don't reuse it unless it's been rotated.

**Branching:**
- Tag `v1.0` now.
- Build on a `whereabouts` branch. Vercel preview deploys run against a **Neon branch database**, with a test bot and a test group.
- Merge to `main` only when CI is green (`npm test`, `typecheck`, `lint`), with the flags off in production. A build error in new code would otherwise block v1 deploys, so nothing merges red.

---

## 2. Tech stack
| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 App Router + TypeScript** (existing) | One codebase and one deploy for the web app, Mini App and bot webhook |
| UI | Tailwind + shadcn on Base UI (existing). The Mini App maps Telegram theme variables (`--tg-theme-*`) onto the shadcn tokens | Looks native in Telegram, light and dark |
| Mini App SDK | `telegram-web-app.js` (official script) | BackButton, MainButton, haptics, theme, `initData` |
| Bot | **grammY** on a webhook (`webhookCallback(bot, "std/http")`) in a route handler. Conversation state lives in Postgres because Vercel functions are stateless | TypeScript-first; works on serverless |
| DB | **Neon Postgres, ap-southeast-1** + **Drizzle** (existing). New tables in `lib/wb/db/schema.ts` | Proven here; Neon branches give safe preview databases |
| Validation | zod (existing) | Shared by the Mini App forms and the bot's flow answers |
| Jobs | **Vercel Cron, daily only**: an evening round at 1900 SGT. Anything time-sensitive is done **lazily**: the projector runs on every write and before every parade-state load | Works on the Hobby plan; no minute-by-minute cron needed |
| Hosting | Vercel `sin1` (existing) | Same region as the database |
| Documents | Photos stay on Telegram; the database stores only the `file_id`. The Mini App shows them through an auth-checked proxy route (`getFile`) | No new place where medical documents are stored |
| Tests | Vitest (existing). The bot is driven by a fake Telegram, replacing `simulate.py` | |

Check grammY, Mini App `initData` and the Next 16 APIs against Context7 and `node_modules/next/dist/docs/` during implementation.

---

## 3. Data model (all new tables, prefixed `wb_`)
These reference the v1 tables `person`, `camp` and `subunit` but never modify them.

| Table | Holds |
|---|---|
| `wb_member` | A Telegram identity linked to a roster `person`: `telegram_user_id` (unique), `person_id` (null until matched), full name, NRIC last 4, ORD date, `leave_left`, stay-out (`PERM`/`TEMP` + until), `source` (`ROSTER`/`SELF`), `registered_at`, `active` |
| `wb_grant` | Who may do what: `member_id`, role (`GC`, `PS`, `PC`, `2IC`, `OC`, `CSM`, `ASA`, `ADMIN`), scope (`subunit_id` or `camp_id`; null means company-wide). This is explicit, rather than Sabre Bot's "membership of the chat is the permission" |
| `wb_commander_chat` | `subunit_id` → `chat_id` + `thread_id` (Sabre Bot's `/here`) |
| `wb_record` | **The timeline.** One row per fact about one trooper. `kind`: `RSI`, `RSO`, `MC`, `HL`, `STATUS`, `MA`, `AL`, `OL`, `OFF`, `EVENT`. Other columns: `parent_id` (outcome chain), `start_at`/`end_at` (timestamptz; a null end means a permanent status), `absent` (bool), `state` (`PENDING`, `APPROVED`, `REJECTED`, `RECORDED`, `CANCELLED`, `WITHDRAWN`), `decided_by`/`decided_at`/`decision_note`, `leave_days`, `detail`, `location`, `ma_timing`, `mc_category`, `diagnosis`, `evidence_file_id`, `onens` (`NA`/`OWED`/`DONE`), `created_by`, `created_via` (`SELF`/`PROXY`/`IMPORT`). Indexed on (`person_id`, `start_at`, `end_at`) |
| `wb_assignment` | Extra, RF and SOL: `person_id`, `type`, `camp_id` (where they stand), `start_at`/`end_at`, `rf_request_id`, `state`, `created_by`. It says *where they stand*, not that they're away, so it's kept apart from `wb_record` as Sabre Bot does |
| `wb_rf_request` | A camp says it'll be short: `camp_id`, role (`GC`/`ST CBT`/`ST SVC`/`ANY`), how many, `start_at`/`end_at`, reason, raised by, state (`OPEN`/`FILLED`/`CLOSED`) |
| `wb_shift_pattern` | Per camp: `kind` (`CYCLE` with `on_days`/`off_days`/`anchor_date`/`hoto_time`; `WEEKLY` mask, for RG 5-in-2-out; `ALWAYS`). Also `both_on_allowed` for SRF |
| `wb_shift_event` | A HOTO log entry: camp, time, on/off, who. Confirms the cycle or re-anchors it |
| `wb_min_manning` | Per camp: minimum `gc`, `st_cbt`, `st_svc` (Sabre Bot's `1:4:3`) |
| `wb_claim` | Transport claim: member, vehicle type, date, start/end location, reason, round trip, state, OC decision and remarks |
| `wb_projection` | Link table: `record_id` or `assignment_id` → the v1 `absence_id` or `duty_id` it created. This is how the projector knows which v1 rows it owns |
| `wb_conversation` | Bot flow state: user, chat, flow, step, `answers` (jsonb), `ctx` (jsonb), `updated_at` |
| `wb_card` | Every approval or RF card sent: record or request id → `chat_id`, `message_id`. Used to edit cards after a decision |
| `wb_audit` | Every change and every **read of a diagnosis or document** |

Role names are normalised with a port of Sabre Bot's `ROLE_ALIASES`, because v1's `person.role` is free text such as "GUARD COMM".

---

## 4. How it works

### 4a. Identity
- **Joining:** a trooper opens the bot, taps **Open Sabre** and the Mini App launches. The server checks Telegram's signed `initData` (HMAC with `WB_BOT_TOKEN`).
- **Registration is confirm, not fill.** The trooper types their name, it's matched against v1 `person`, they tap "That's me", and they add only their full name, NRIC last 4 and ORD. Rank, camp and platoon come from the roster.
- **Anyone not on the roster** becomes `SELF` and shows up on Gaps for an ASA to add.
- **Sessions:** a signed cookie (`SameSite=None; Secure; Partitioned`, so it also works inside Telegram Web's iframe). Server actions call `requireMember()` and `requireGrant(role, scope)`.
- **Group chats:** a group can't use `web_app` buttons, so its links use `t.me/<bot>/app?startapp=<route>`.

### 4b. The timeline, and "present" worked out from it
Where a trooper is on any day comes from:
- their home camp's shift on that day (the shift pattern, adjusted by HOTO events);
- minus `wb_record` rows that are `absent` and `APPROVED` or `RECORDED` and cover that time;
- plus or minus `wb_assignment` rows, using Sabre Bot's single rule for Extra, RF and SOL (`servingCampId` in `lib/parade/compute.ts`).

A `STATUS` row, such as light duty, is tracked but never makes anyone absent. `RSI` is never absent either. `RSO` is absent for the day.

### 4c. The lifecycle of a record
| Kind | Who enters it | Approval | Absent? |
|---|---|---|---|
| AL / OL / OFF | Trooper | PC or PS of the platoon | yes |
| RSI / RSO | Trooper | PC or PS | RSI no, RSO yes |
| MC / HL / STATUS | Trooper, as the outcome of an RSI, RSO or MA, or standalone | none (`RECORDED`) | MC/HL yes, STATUS no |
| MA | Trooper ("Same as last time?" shortcut) | none | yes, for the timing |
| EVENT (course, IPPT) | Trooper, or a commander for several men at once | none | yes |
| Claim | Trooper | OC | n/a |

**Applying** (Mini App form with a date-range picker):
1. **Clash check:** existing records, assignments and SOL on those dates are shown with "Carry on" or "Change dates". It's never a refusal.
2. **Leave:** the trooper unticks days already off-shift or public holidays, and the form checks their balance.
3. **Submit:** the row is saved as `PENDING`, and a **card** goes to the platoon's commanders chat.

**The card** shows:
- the request;
- the **manning impact**: the worst day in the range for the camp, with this trooper counted out, against the per-role minimum (port of `engine._manning`);
- buttons: Approve, Reject, Open.

Decide-once is enforced in the database (`UPDATE … WHERE state='PENDING'`). The person who decided gets **Undo** for 10 minutes and, after a rejection, **Say why**. Leave is deducted on approval and refunded on undo or void. The trooper is notified in a DM.

**Medical chain:**
- An approved RSI, RSO or MA gets **Update outcome** in My records: MC or HL (category + diagnosis + dates), up to 4 statuses (temporary or permanent, dates), a photo, and whether it's on ONENS (asked only for civilian MCs). These are saved as child rows with `parent_id`.
- **Diagnosis and photo are visible only** to the trooper, their PC and PS, and OC, 2IC and CSM. **They never appear on group cards.** Cards show "MC 3 days · Respiratory".

**Fixing mistakes:** a commander can **void** (cancelled, with chained rows and refunds). A trooper can **withdraw** a pending request.

### 4d. Shifts and forecasting
- `wb_shift_pattern` projects each paired camp's on/off days from its anchor and cycle. RG camps use a weekday mask.
- A **HOTO** (the GC taps "Handed over" in the Mini App or bot) logs a `wb_shift_event`:
  - If it matches the pattern, it's confirmation.
  - If not, it re-anchors the pattern and alerts the PS.
  - When projection is on, it also flips v1 `camp.onShift` through the extracted `setCampShift` logic.
- **`snapshotAt(t)`** builds a v1 `CoySnapshot` for any future moment (roster + projected shifts + timeline) and runs it through the **unchanged** `computeCoy`. The forecast reuses the proven counting engine.
- A per-role layer on top compares strength with `wb_min_manning`.
- **Forecast grid:** camps × the next 14 days, with each cell showing strength in the form `0:4:3 / min 1:4:3`. Red means below minimum; striped means it depends on pending requests.

### 4e. RF requests and deploy
- A GC or above raises a request. A card goes to every commanders chat and to the RF board.
- **Deploy:** a commander picks a man, which creates a `wb_assignment` linked to the request. The card's "short by N" updates everywhere.
- An assignment at another camp marks them absent at home and present at that camp, using the same rule as v1 `duties.ts`.

### 4f. Projection: the bridge into the parade state (only when `FEATURE_PROJECTION` is on)
`lib/wb/projection.ts` runs `syncProjection(now)` after every write and again before a parade state is loaded.

**Records:**
- For each trooper, it finds the active absent record and maps it to a v1 absence type:
  - MC → MC, HL → HL, AL → AL, OL → OL, OFF → OFF;
  - MA → MA, with timing and location;
  - RSO and EVENT → OTHERS, with the detail as the reason.
- **Priority** when several overlap: HL > MC > OL > AL > OFF > OTHERS > MA. This is needed because v1 allows one open absence per person.
- It opens or updates the v1 `absence` row through the extracted `setStatus` core and records ownership in `wb_projection`.
- **It never overwrites an absence a GC entered by hand.** It flags the conflict in the Mini App instead.

**Assignments:** these map to v1 `duty` rows through the extracted `saveDuty` and `endDuty` core.

**v1's "never auto-revert" rule is kept.** When a record ends, the projector doesn't close the absence. The evening round asks the GC "X's MC ended. Back?" and one tap closes it. Overdue absences still block generation, exactly as now.

**Turning projection off** just stops the syncing. Every row it already wrote is an ordinary v1 row, and the GCs carry on by hand.

### 4g. The evening round (1900 SGT cron)
- MCs and statuses ending tonight: tell the trooper, and send the GC "back tomorrow" taps.
- MA or event tomorrow: remind the trooper.
- ONENS uploads still owed.
- Requests pending more than 12 hours: send a digest to the commanders chat.
- An RSI or RSO that's approved but has no outcome after 24 hours: chase the trooper.
- A heartbeat to the admin.

---

## 5. Screens
**Mini App** (`app/(tg)/tg/…`, its own layout, no v1 password):
- **Everyone:** Home (where I am now and what's next) · My records (one card per visit, update outcome, withdraw) · Apply (sick, MA, AL, OL, off, event, claim) · Profile.
- **GC:** Camp check (expected people at CAA; tap only the differences) · HOTO · Raise RF.
- **PS/PC:** Approvals · Today and Day (platoon) · Forecast grid · Person history · Add for several men · Void · RF board · Gaps · ONENS owed.
- **OC/2IC/CSM/ASA:** company Forecast · Claims (OC decides) · Grants and commander-chat admin · a link to the v1 parade-state web app.

**Which chats the bot is in** (full table in whereabouts-status.md §4):
- each trooper's DM;
- each platoon commanders' chat, linked with `/here`;
- the COY HQ chat.

It is never in troopers' platoon groups or the parade-state topic. Approving needs a `wb_grant`; being in the chat is not enough. Privacy mode stays on.

**Cost:** must stay free (Vercel Hobby, Neon free, Telegram). Crons run daily only.

**Bot (thin):**
- `/start` opens the Mini App.
- Approval, RF and claim cards with inline buttons.
- DM notifications.
- `/here` to link a chat.
- Quick commands (`/sick`, `/leave`, `/today`, …) that just deep-link into the Mini App.

All forms live in the Mini App rather than as chat steps, because a calendar range picker beats chat questions. `wb_conversation` is needed only for "Say why" and small prompts.

---

## 6. Code layout (new code only)
```
lib/flags.ts                       FEATURE_* readers; notFound() guard helper
lib/wb/db/schema.ts                all wb_ tables
lib/wb/domain/                     pure, no I/O, fully unit-tested
  timeline.ts                      covers/touches/overlaps, activeAt, clash (port store.py helpers)
  rules.ts                         approval matrix, leave days, outcome chain, void cascade
  roles.ts                         ROLE_ALIASES, MC_CATEGORIES, LEAVE_REASONS, VEHICLE_TYPES, CAMP_ADDRESS (port config.py)
  shifts.ts                        pattern projection, HOTO re-anchor
  forecast.ts                      snapshotAt() -> computeCoy(); per-role manning; worstDay()
  projection-map.ts                record -> v1 absence mapping + priority (pure)
lib/wb/projection.ts               syncProjection() (DB, uses extracted v1 cores)
lib/wb/auth.ts                     initData verify, session, requireMember/requireGrant
lib/wb/telegram/                   grammY bot, cards, notify, deep links
lib/wb/actions/                    server actions: records, decisions, rf, shifts, claims, admin
app/(tg)/tg/...                    Mini App screens
app/api/wb/telegram/route.ts       webhook (secret-token checked)
app/api/wb/cron/evening/route.ts   CRON_SECRET-checked
app/api/wb/file/[id]/route.ts      photo proxy, grant-checked, audited
```

**Reused as is:** `lib/parade/compute.ts` (`computeCoy`, `servingCampId`, `indexCamps`), `lib/parade/types.ts` (`CoySnapshot`), `lib/parade/time.ts` (`toSgt`, `sgtToInstant`, `currentCaa`), the query shape of `lib/data/snapshot.ts` `loadSnapshot`, and `lib/actions/shared.ts` `run`.

**Ported from sabre-bot:**
- `flows.py`: questions, wording, checks, clash, leave days, outcome branching.
- `engine.py`: `_manning`, `chase`/`_ending`/`_tomorrow`, `void_do`/`_void_kin`, `_visit_card`, `show_stats`.
- `store.py`: `covers`, `touches`, `overlaps`, `days_between`, `Minimum`/`parse_minimum`.
- `config.py`: vocabularies, `SHIFT_PAIRS`, `PAIRS_BOTH_ON`.
- `checks.py`: its assertions become Vitest cases.

---

## 7. Phases (each ships behind flags; nothing touches production v1 until §4f is switched on)
0. **Freeze v1:** tag `v1.0`, roll out the parade state. Set up the branch, a Neon branch database, a test bot and a test group.
1. **Foundation:** flags, `wb_` schema and migrations, Mini App shell and `initData` auth, registration, grants, `/here`, Gaps.
2. **Self-service timeline (shadow mode):** AL/OL/OFF/MA/EVENT, clash check, leave balance, cards with approve/undo/say-why, My records, void/withdraw, Add for several men.
3. **Medical:** RSI/RSO → outcome chain, diagnosis and photo with restricted visibility, ONENS, evening round. **Gate:** S6 sign-off before this goes live with real data.
4. **Shifts and forecast:** patterns, HOTO, per-role minimum manning, `snapshotAt`, forecast grid, manning impact on cards, Today/Day/Camp check.
5. **RF requests and deploy:** requests, board, deploy, assignments.
6. **Projection:** extract the v1 cores (no behaviour change, v1 tests green), then build `syncProjection`. Run in shadow for 1–2 weeks: a nightly diff report of projected vs GC-entered absences goes to the admin. Turn `FEATURE_PROJECTION` on once the diff is clean.
7. **Transport claims:** flow, OC decision card, optional Sheets export for the OC.

Later: stats and S1 return from `mc_category`, stay-out in the night parade state, broadcast, ORD auto-deactivation, Telegram login for the v1 web app.

---

## 8. Verification
- **v1 safety:**
  - `npm test` stays green on every merge, including the golden parity tests in `tests/`.
  - A new test boots with all flags off and checks that `/tg/*` and `/api/wb/*` return 404 and that crons and the projector do nothing.
  - `drizzle` migrations contain no `ALTER`/`DROP` on v1 tables (a CI grep check).
- **Unit (pure domain):** timeline overlaps, shift projection across cycles and HOTO re-anchors, forecast matching `computeCoy` on today's snapshot, projection mapping and priority, leave-day maths, void cascade. The ported `checks.py` cases also run here.
- **Bot and Mini App integration:** a fake Telegram transport replays the `simulate.py` scenarios: registration → RSO → approve → MC + status → handover → evening round. Assert the database rows and the messages sent.
- **Projection:** DB tests on `sabre_test`. A projected MC appears in `loadSnapshot` and renders in the parade state. A manual GC absence is never overwritten. Turning projection off leaves valid v1 rows.
- **End to end on preview:** a Neon branch, a test bot and the test group. Open the Mini App on a real iPhone and Android phone, run the leave, sick and RF flows, check the cards, Undo and the forecast grid. Run the evening round by hand.
- **Shadow run in production:** the nightly diff report shows nothing unexplained for 1–2 weeks before `FEATURE_PROJECTION` is switched on.
