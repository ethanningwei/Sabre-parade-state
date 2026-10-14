# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 7 (transport claims)**. Phases 1–6 are built. Phase 6 (projection) runs in shadow mode on the preview first: ask me how the shadow diffs have looked, whether `FEATURE_PROJECTION=1` is on the preview yet, and whether I've done its phone check (status §3a, "Test on the phone (Phase 6)"). If not, help me through those first; claims don't depend on projection, so we can build Phase 7 while the shadow week runs.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§1 "The kill switch", §3 `wb_claim`, §4c the record lifecycle, §5 screens). Then Sabre Bot's claim flow, which Phase 7 ports: `~/Desktop/Claude Code/sabre-bot` `flows.py` (`CLAIM`, `claim_days`, `_place`), `config.py` (`CAMP_ADDRESS`, `address_of`, `VEHICLE_TYPES`, `TAB_CLAIMS`, `CLAIM_HEADERS`), `store.py` (`Claims`, append-only, never touching the OC's columns) and `checks.py` (the claim checks). On the whereabouts side read `lib/wb/decide.ts` (submit/decide/undo/withdraw, decide-once), `lib/wb/core.ts` (`inTx`: every write syncs the projector after it), `lib/wb/telegram/courier.ts` and `cards.ts`, `lib/wb/evening.ts`, and an existing apply form (`app/(tg)/tg/apply/off/page.tsx`).
3. **Before writing code, ask me** the §6 questions marked *(Phase 7)* and the two marked *(Phase 6, check)*, together, in one message, as multiple choice.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - Everything behind `FEATURE_CLAIMS` (and `FEATURE_WHEREABOUTS`). With it off, nothing of claims shows: pages 404, actions refuse, `/claim` says it's not on.
   - Never ALTER a v1 table (0009 is `wb_` only). Never touch `lib/parade/`. Claims touch no v1 table at all.
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. The guard test enforces the flags (extend it for `FEATURE_CLAIMS`).
   - Every Telegram message through the Courier; every write through `inTx`.
   - It must stay free: a Google service account for the Sheets export is free; no paid services, crons stay daily.
5. Use Context7 for grammY, the Telegram Mini App API, Drizzle and (if the export is built) the Google Sheets API. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Add pure tests (days, office addresses, never past) and DB tests in the style of `tests/wb/rf.db.test.ts`.
7. The preview is already set up (status §3a, "Preview environment"; the database is `ep-hidden-sea`). Apply the new migration to the Neon preview branch before I push, checking the host (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` if the command lists changed and `-- status` once the preview is built. `FEATURE_CLAIMS=1` goes on the **preview only**.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 7's state in §2, update §3a (what exists now), write what comes after Phase 7 into §3b (the plan's "Later" list, or production rollout: merging `whereabouts` into `main` and switching the flags on there), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for the next session.
