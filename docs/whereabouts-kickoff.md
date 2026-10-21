# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 8 (GC Camp check)**. Phases 1–7 are built. Phase 7 (transport claims) needs its phone check on the preview: the preview writes to the OC's real sheet and its Vercel variables are set; ask me whether I've pushed, run `npm run wb:setup -- claims`, done the checklist and deleted the test rows (status §3a, "Before the phone test (Phase 7)" and "Test on the phone (Phase 7)"). If not, help me through those first. Phase 6 (projection) may still be in its shadow week: ask how the diffs look and whether `FEATURE_PROJECTION=1` is on the preview yet.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md` (§1 "The kill switch", §4 shifts and the forecast, §5 screens). On the code side, read `lib/wb/domain/forecast.ts` (`snapshotFor`), `lib/wb/forecast-data.ts` (`forecastInput`, `campsInfo`), `lib/wb/domain/shifts.ts` (`onShiftAt`), `lib/wb/rf-data.ts` (`liveAssignments`), `lib/wb/write.ts` (`write`), `lib/wb/telegram/courier.ts`, `lib/wb/evening.ts`, and an existing GC screen (`app/(tg)/tg/hoto/page.tsx`).
3. **Before writing code, ask me**, together, in one message, as multiple choice: the *To settle* points in status §3b, and the §6 questions marked *(Phase 7)* (office addresses, when the Form SG closes, the evening-only read-back).
4. Build Phase 8 as in status §3b, following the ground rules in §1. The most important:
   - Everything behind `FEATURE_WHEREABOUTS` (decide with me whether Camp check gets its own flag, like `FEATURE_CLAIMS`). With it off, nothing of it shows: pages 404, actions refuse.
   - A "missing" tap **only flags**: it never writes the parade state. The GC keeps editing the v1 web app as now.
   - Never ALTER a v1 table (the next migration is **0012**, `wb_` only). Never touch `lib/parade/`.
   - Keep the patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. The guard test enforces the flags.
   - Every Telegram message through the Courier; every write through `write()` (`lib/wb/write.ts`).
   - It must stay free: no paid services, crons stay daily.
5. Use Context7 for grammY, the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Add pure tests and DB tests in the style of `tests/wb/claims.db.test.ts`.
7. The preview is already set up (status §3a, "Preview environment"; the database is `ep-hidden-sea`). Apply the new migration to the Neon preview branch before I push, checking the host (§3a says how). Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` if the command lists changed and `-- status` once the preview is built.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 8's state in §2, update §3a (what exists now), write what comes next into §3b (the plan's "Later" list, or production rollout: merging `whereabouts` into `main` and switching the flags on there, with the claims sheet configured first), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for the next session.
