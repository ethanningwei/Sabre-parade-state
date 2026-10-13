# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 6 (projection into the parade state: extract the v1 cores, the projector, shadow diff first)**. Phases 1–5 are built; Phase 5 (RF requests, deploy, Assign) still needs checking on my phone. Tell me if I haven't done that yet, and run through its checklist (status §3a, "Test on the phone (Phase 5)") with me first.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§1 "The kill switch", §4f "Projection" and §4g "The evening round" matter most), then `docs/STATUS.md` §2 for the v1 rules the projector must respect (one open absence per person, never auto-revert, overdue blocks generation, Extra/RF home absence, off-shift camps locked). Read the v1 code the projector writes through: `lib/actions/attendance.ts` (`setStatus`, `setCampShift`), `lib/actions/duties.ts` (`saveDuty`, `syncHomeAbsence`, `endDuty`), `lib/actions/shared.ts` (`run`, `audit`), `lib/authz.ts`, `lib/data/snapshot.ts` and `lib/data/current.ts`, and `lib/db/schema.ts` (`absence`, `duty`, `camp`, `audit_log`). Then the whereabouts side: `lib/wb/domain/forecast.ts` (how a record and an assignment already become a v1 absence and duty in the forecast: `asAbsence`, `sentAbsence`, the duties), `lib/wb/rf.ts`, `lib/wb/decide.ts`, `lib/wb/outcome.ts`, `lib/wb/shifts.ts` (`logHoto`) and `lib/wb/evening.ts`.
3. **Before writing code, ask me** the §6 questions marked *(Phase 6)*, together, in one message, as multiple choice. The Sheets re-import question blocks projection: settle it first.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - With the `FEATURE_*` flags off, the app must behave exactly like v1.0. With `FEATURE_WHEREABOUTS` on and `FEATURE_PROJECTION` off (shadow mode), **no v1 row is written**.
   - Extracting `setStatus`, `setCampShift`, `saveDuty` and `endDuty` into plain cores is approved, with **no behaviour change** (the v1 tests and golden parity tests stay green). Any other v1 edit (e.g. calling the projector from `currentSnapshot`) needs my yes from step 3.
   - Never ALTER a v1 table (0008 is `wb_` only). Never touch `lib/parade/`.
   - Never overwrite an absence a GC typed; never auto-revert; RSI/RSO/STATUS are never projected.
   - Medical privacy still holds: a projected MC carries no diagnosis (v1 has no column for it anyway).
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. The guard test enforces the flags.
   - Crons stay daily: the shadow diff rides on the evening round.
5. Use Context7 for grammY, the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Commit the core extraction on its own first, with the v1 suite green, before any projector code. Add pure tests for the mapping and priority, and DB tests in the style of `tests/wb/rf.db.test.ts` for shadow mode (nothing written, the diff right) and projection on (AL → v1 absence in `loadSnapshot`, a manual absence never overwritten, MC end → "Back?" tap closes it, void closes, deploy → v1 duty + home absence, stand down ends it, HOTO flips `on_shift`, flag off leaves ordinary v1 rows).
7. The preview is already set up (status §3a, "Preview environment"). Apply the new migration to the Neon preview branch before I push, checking the host is the preview branch (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` if the command lists changed and `-- status` once the preview is built. `FEATURE_PROJECTION=1` goes on the **preview only**, and only after I've seen a clean shadow diff.
8. Before finishing:
   - Give me a short checklist of what to test on my phone and in the v1 web app.
   - Update `docs/whereabouts-status.md`: mark Phase 6's state in §2, write the Phase 7 spec (transport claims) into §3 in the same detail, update §3a (what exists now), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for Phase 7.
