# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 3 (Medical: report sick and outcomes, ONENS, evening round)**. Phases 1 and 2 are done; Phase 2 was checked on my phone (tell me if I haven't done that yet, and run through its checklist with me first).

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§4c "Medical chain" and §4g "The evening round" matter most), then `docs/STATUS.md` §2 for the v1 domain rules. For the logic you're porting, read Sabre Bot in `~/Desktop/Claude Code/sabre-bot`: `flows.py` `SICK`, `OUTCOME` and `_status_block`; `engine.py` `_commit_sick`, `_commit_outcome`, `_visit_card`, `_void_kin`, `chase`/`_ending`/`_tomorrow` and `onens_groups`; `config.py` `MC_CATEGORIES`, `STATUSES` and `MAX_STATUSES`; `checks.py`.
3. **Before writing code, ask me** the §6 questions marked *(Phase 3)*, together, in one message. **Gate:** no real medical data until S6 has signed off. Build and test on the preview with test data only.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - With the `FEATURE_*` flags off, the app must behave exactly like v1.0.
   - Never ALTER a v1 table. Never touch `lib/parade/`. Editing `vercel.json` (for the cron) is a v1 file: only with my go-ahead.
   - `FEATURE_PROJECTION` stays off: nothing reaches the parade state.
   - Diagnoses and photos never appear on a group card, and every read of them is written to `wb_audit`.
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. All decisions go through `lib/wb/decide.ts`. The guard test enforces the flags.
5. Use Context7 for grammY (`sendPhoto`, `getFile`, file downloads), the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16 (route handlers that stream, and Vercel cron routes).
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Extend `tests/wb/records.db.test.ts` and `tests/wb/bot.db.test.ts` (the fake Telegram) for report sick, outcomes, visibility and the evening round.
7. The preview is already set up (status §3a, "Preview environment"). Apply the new migration to the Neon preview branch before I push, checking the host is the preview branch (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` and `-- status` once the preview is built.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 3 done in §2, write the Phase 4 spec into §3 in the same detail as Phase 3, update §3a (what exists now), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for Phase 4.
