# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 4 (Shifts and forecast: patterns, HOTO, minimum manning, forecast grid, manning on cards)**. Phases 1–3 are built; Phase 3 (medical) still needs checking on my phone. Tell me if I haven't done that yet, and run through its checklist (status §3a, "Test on the phone (Phase 3)") with me first.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§4b "present worked out from the timeline", §4d "Shifts and forecasting" and §4c's card/manning impact matter most), then `docs/STATUS.md` §2 for the v1 domain rules (shifts, `camp.post`, off-shift camps, Extra/RF/SOL). Read `lib/parade/compute.ts` (`computeCoy`, `servingCampId`, `indexCamps`) and `lib/data/snapshot.ts` (`loadSnapshot`), which the forecast reuses unchanged. For the logic you're porting, read Sabre Bot in `~/Desktop/Claude Code/sabre-bot`: `config.py` `SHIFT_PAIRS`, `PAIRS_BOTH_ON`, `is_paired`, `partner_of`, `ROLES_GUARDROOM`; `store.py` `Minimum`, `parse_minimum`, `manning_on`; `engine.py` `_manning`, `_floor_line`, `_strength`, `hoto`; `checks.py`.
3. **Before writing code, ask me** the §6 questions marked *(Phase 4)*, together, in one message.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - With the `FEATURE_*` flags off, the app must behave exactly like v1.0.
   - Never ALTER a v1 table. Never touch `lib/parade/` (the forecast calls `computeCoy` as it is). Never write v1 `camp.on_shift`: the HOTO only logs `wb_shift_event` until Phase 6.
   - `FEATURE_PROJECTION` stays off: nothing reaches the parade state.
   - Medical privacy still holds: the forecast and day views use `RecordView` (never a diagnosis); diagnoses and photos are read only through `lib/wb/medical.ts`.
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. All decisions go through `lib/wb/decide.ts`. The guard test enforces the flags.
   - Crons stay daily: anything else is worked out on read.
5. Use Context7 for grammY, the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Add pure tests for shifts, minimum manning and `snapshotAt` parity, and extend `tests/wb/records.db.test.ts` and `tests/wb/bot.db.test.ts` (the fake Telegram) for the manning line on cards, HOTO and the forecast.
7. The preview is already set up (status §3a, "Preview environment"). Apply the new migration to the Neon preview branch before I push, checking the host is the preview branch (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` and `-- status` once the preview is built.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 4 done in §2, write the Phase 5 spec into §3 in the same detail as Phase 4, update §3a (what exists now), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for Phase 5.
