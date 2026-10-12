# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 5 (RF requests and deploy: requests, the RF board, deploy, assignments in the forecast)**. Phases 1–4 are built; Phase 4 (shifts and forecast) still needs checking on my phone. Tell me if I haven't done that yet, and run through its checklist (status §3a, "Test on the phone (Phase 4)") with me first. Also raise the SRF questions in status §6 if they're still open.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§3 `wb_assignment`/`wb_rf_request`, §4e "RF requests and deploy" and §4b "present worked out from the timeline" matter most), then `docs/STATUS.md` §2 for the v1 Extra/RF/SOL rules (`servingCampId`, the RF absence at home, double counting). Read `lib/parade/compute.ts` (`servingCampId`, `computeCoy`) and `lib/actions/duties.ts` (v1's RF rule, which Phase 5 mirrors without writing v1), and `lib/wb/domain/forecast.ts` + `lib/wb/forecast-data.ts` (Phase 4's forecast, which assignments plug into). For the logic you're porting, read Sabre Bot in `~/Desktop/Claude Code/sabre-bot`: `config.py` `RF_ROLES`, `RF_REQUESTERS`/`can_request_rf`, `RF_DEPLOYERS`/`can_deploy_rf`, `ASSIGN_TYPES`; `store.py` `RFRequest`, `rf_requests`, `add_rf_request`, `fill_rf_request`, `close_rf_request`, `attachments_at`, `add_assignment`, `away_over`; `engine.py` `_rf_card`, `_rf_buttons`, `_rf_refresh`, `_commit_rf`, `_commit_deploy`, `show_rf`.
3. **Before writing code, ask me** the §6 questions marked *(Phase 5)*, together, in one message, as multiple choice.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - With the `FEATURE_*` flags off, the app must behave exactly like v1.0.
   - Never ALTER a v1 table. Never touch `lib/parade/` (the forecast calls `computeCoy` and `servingCampId` as they are). Never write v1 `duty`, `absence` or `camp.on_shift`: assignments live in `wb_assignment` until Phase 6.
   - `FEATURE_PROJECTION` stays off: nothing reaches the parade state.
   - Medical privacy still holds: RF cards, the board and the deploy screen use `RecordView`/the forecast's away list (never a diagnosis).
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. Decisions go through the decision core (`lib/wb/decide.ts`, and a new `lib/wb/rf.ts` for RF). Reads that `decide.ts` needs stay in `lib/wb/forecast-data.ts` (no import cycle). The guard test enforces the flags.
   - Crons stay daily: anything else is worked out on read.
5. Use Context7 for grammY, the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Add pure tests for RF (short by, cards, permissions, refusals) and for assignments in the forecast (RF counted where he stands and away at home, SOL both ways, parity with v1 duties), and DB tests in the style of `tests/wb/shifts.db.test.ts` (fake Telegram) for raise, deploy (incl. the race for the last slot), close, undeploy and the manning line moving.
7. The preview is already set up (status §3a, "Preview environment"). Apply the new migration to the Neon preview branch before I push, checking the host is the preview branch (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` (there's a new `/rf` command) and `-- status` once the preview is built.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 5 done in §2, write the Phase 6 spec (projection, shadow diff first) into §3 in the same detail as Phase 5, update §3a (what exists now), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for Phase 6.
