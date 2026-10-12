# Whereabouts: kickoff prompt for the next session

Paste the prompt below into a new Claude Code session opened in `~/Developer/Sabre`. After each phase, the session updates the phase number and anything specific in it.

---

We're building the Sabre whereabouts system one phase at a time. This session is **Phase 2 (Self-service timeline, shadow mode)**. Phase 1 is done and verified on my phone.

1. Make sure you're on the `whereabouts` branch (`git switch whereabouts`, then `git pull`). Never commit to `main`.
2. Read `docs/whereabouts-status.md` in full, then `docs/whereabouts-plan.md`, then `docs/STATUS.md` §2 for the v1 domain rules. For the logic you're porting, read Sabre Bot in `~/Desktop/Claude Code/sabre-bot` (`flows.py` AL/OL/OFF/MA/EVENT/ADD and `_clash`, `engine.py` decisions/undo/void/`_no_chat`, `store.py` `covers`/`touches`/`overlaps`/`days_between`, `checks.py`).
3. **Before writing code, ask me** the §6 questions marked *(Phase 2)* and confirm the proposed decision at the end of §5. Ask them together, in one message.
4. Build everything in status §3b, following the ground rules in §1. The most important:
   - With the `FEATURE_*` flags off, the app must behave exactly like v1.0.
   - Never ALTER a v1 table. Never touch `lib/parade/`.
   - `FEATURE_PROJECTION` stays off: nothing reaches the parade state.
   - Keep the Phase 1 patterns in §3a: `requireFeaturePage()` in every `/tg` page and layout, `requireFeature()` before `return run(…)` in every action, `featureOff()` in every `/api/wb` route. The guard test enforces them.
5. Use Context7 for grammY (callback queries, `editMessageText`, `answerCallbackQuery`, `force_reply`), the Telegram Mini App API and Drizzle. Use `node_modules/next/dist/docs/` for Next 16.
6. Commit in small steps, with `npm test`, `npm run typecheck` and `npm run lint` green each time, and `next build` green before you finish. Extend the fake-Telegram bot tests (`tests/wb/bot.db.test.ts`) for cards and decisions.
7. The preview is already set up (status §3a, "Preview environment"). Apply the new migration to the Neon preview branch before I push: `DATABASE_URL="$WB_PREVIEW_DATABASE_URL" npx drizzle-kit migrate`. Never touch the production database. Don't push; tell me when to push, then run `npm run wb:setup -- commands` and `-- status` once the preview is built.
8. Before finishing:
   - Give me a short checklist of what to test on my phone.
   - Update `docs/whereabouts-status.md`: mark Phase 2 done in §2, write the Phase 3 spec into §3 in the same detail as Phase 2, update §3a (what exists now), and add any new decisions and open questions to §5 and §6.
   - Update this kickoff prompt for Phase 3.
