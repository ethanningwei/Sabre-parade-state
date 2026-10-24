@AGENTS.md

# Sabre — notes for Claude

- **Whereabouts work (branch `whereabouts`): start with `docs/whereabouts-status.md`, then `docs/whereabouts-plan.md`.** That work is a Telegram bot and Mini App behind `FEATURE_*` flags. The phases after Ops Vigilance (ROT, Ops Bacinet) are planned in `docs/phases-plan.md`. It must never change v1 behaviour while the flags are off, and must never ALTER v1 tables.
- **Start with `docs/STATUS.md`.** It covers what's live, the domain rules (attendance, shifts, Extra/RF/SOL), the decisions log, known limitations and where v2 starts. Then read README.md for setup, import and deploy. `docs/v1-plan.md` is historical.
- The user is one of three admin support assistants (ASAs) in Sabre coy (8SIR, SAF). Use their vocabulary: GC = guardcomm, CAA = correct-as-at, RF, SOL (stoppage of leave), MC/AL/OL/HL/OFF/MA.
- **Parity is sacred.** Any change in `lib/parade/render.ts` or `compute.ts` must keep `npm test` green. The golden text is real bot output, and trailing spaces in `tests/fixtures/example-300926.txt` matter.
- Every server action calls `actionViewer()` or `actionAdmin()`, plus the relevant `assertCanEdit*` scope check, before touching data. Mutations write to `audit_log` via `audit()`.
- Sign-in is **one shared password** plus a typed rank and name. Everyone is an admin. Per-platoon scoping is dormant, not deleted.
- Dates are `YYYY-MM-DD` strings and times are `HHMM` strings, both in SGT (a fixed +08:00). Use the helpers in `lib/parade/time.ts`.
- `lib/data/snapshot.ts`, `write-coy.ts` and `parse-export.ts` must stay importable from plain Node (the scripts use them): no `server-only`, no Next APIs. Pages use the per-request memo in `lib/data/current.ts`.
- UI components are shadcn on **Base UI** (the `render` prop, not `asChild`). Check `components/ui/*` before use.
- Mobile first: large tap targets, bottom sheets for editing, bottom nav. Native `<select>`s must not set `text-sm`, because iOS zooms on focus below 16px.
- Production: Vercel `sin1` + Neon Singapore. Apply migrations to production **before** pushing code that needs them. **Auto mode blocks `git push`**, so commit and ask the user to push.
- Never commit `credentials.json`, `.env*` (except `.env.example`) or `*-export.json`. `.env.production.local` holds only Vercel `[SENSITIVE]` placeholders, apart from the production `DATABASE_URL_UNPOOLED`.
