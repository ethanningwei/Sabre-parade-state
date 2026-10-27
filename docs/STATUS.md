# Sabre: project status and handover

**Start here.** This is the single source of truth for what exists, why it's that way, and where v2 picks up. Last updated **2026-09-30**, at the end of v1.

- **How to run, deploy and import:** see [README.md](../README.md).
- **The original v1 plan:** see [v1-plan.md](v1-plan.md). It's kept for history, and parts of it were superseded (see *Decisions log*).
- **The bot being replaced:** `legacy/paradestate.py`. Its guide lives with the ASAs and isn't in this repo.

---

## 1. What v1 is

A mobile-first web app for **Sabre coy (8SIR, SAF)** that replaces the parade-state Telegram bot and its Google Sheets.
- Guardcomms (GCs) update attendance, shifts and Extra/RF/SOL on their phones.
- The app checks everything, then generates the parade state. You can copy it, or send it to the coy's Telegram topic.
- Built for the 3 admin support assistants (ASAs) who run guardroom ops.

**Live:**

| | |
|---|---|
| Hosting | Vercel project `sabre`. Functions run in `sin1` (Singapore), pinned in `vercel.json`. |
| Database | Neon Postgres, `ap-southeast-1` (Singapore), via the Vercel Marketplace. The free plan sleeps after 5 minutes idle, so the first request after that takes about 1 s. |
| Repo | `github.com/ethanningwei/sabre` (private). Pushing to `main` deploys to production. |
| Coy | Config key `PL5-8 COY`, display name **Sabre**: COY HQ plus Platoons 5–8, 14 camps, about 214 people. |
| Telegram | The old bot's token (`TELEGRAM_BOT_TOKEN`). The target chat and topic are set in **Admin › Coy settings**. |

**Where the rollout stands (as of 2026-09-30):**
- Real data is imported, and the output is proven identical to the bot's (`✅ PARITY`).
- The Telegram target is configured.
- The **parallel run and cutover aren't recorded as done.** The old bot may still be running on the GCP VM.
- Check with the user before assuming the bot has been retired. The cutover checklist is in the README.

---

## 2. Domain rules (what the code enforces)

The parade-state engine is `lib/parade/` (pure TypeScript, no I/O). Its output must match the bot **character for character**; this is covered by golden tests against real bot output.

**Attendance**
- A person with no open `absence` row is **PRESENT**.
- Absence types: HL, MC, OL, AL, OFF, MA, OTHERS.
- **HL, MC, OL, AL and OFF need start and end dates.**
- **OTHERS** needs a reason. Its dates are optional: the user tried making them compulsory, then reverted.
- **MA** needs a timing. It covers one day, and an MA from a previous day is flagged as overdue.
- Times are always optional. They only print when both start and end times are filled in.
- **Overdue:** if the end is before the CAA time, generation is blocked. The app never auto-reverts anyone to present. A date-only end lasts until 23:59 SGT.

**Shifts** (teams take turns at a physical camp)
- Each camp is a team, e.g. SFT A. `camp.post` groups teams into their physical camp: SFT A + SFT B = SFT. A null `post` means the camp is its own physical camp.
- **An off-shift camp** counts as 00 present and lists no names. Its people are **not validated**, its attendance **can't be edited** (locked in the UI and the server action), and **Extra/RF/SOL there don't count**.
  - The bot did count those Extra/RF/SOL at platoon level. That bug has been fixed.

**Extra / RF / SOL** (`duty` table; logic in `lib/parade/compute.ts` › `servingCampId` and `lib/actions/duties.ts`)
- **SOL** (stoppage of leave) is tied to the person.
  - While their own team is on shift, they're simply present there.
  - When their team is off, they count as SOL under the **on-shift team of the same physical camp**.
  - There's no camp picker.
  - Legacy imported SOLs that aren't linked to a person keep a fixed camp.
- **RF and Extra** are served at **another** team, never the person's own.
  - A roster person is automatically marked absent at home as `OTHERS: "RF @ BDK"` with the duty's dates. That absence is linked via `absence.duty_id`, follows the duty, and closes with it.
  - If they're already absent at home (e.g. on MC), that absence is kept.
- **Double counting:** if an RF/Extra person is still counted present at an on-shift home team, generation is blocked (`double-counted`).
- **HQ** never adds Extra/RF/SOL to its count, but still lists them. This matches the bot.

**Validation:** generation is blocked while any issue exists. Every issue links to where it's fixed. This mirrors the bot's "report everything, print nothing" rule.

---

## 3. Decisions log

| Date | Decision | Notes |
|---|---|---|
| 2026-09-30 | Own Postgres database replaces Sheets. One-time and daily re-runnable import from Sheets | Uses the bot's own code for reading and validation, then proves parity |
| 2026-09-30 | Next.js on Vercel, Neon Postgres (Singapore), Drizzle | |
| 2026-09-30 | Telegram: an in-app Send button replaces `/print`. The bot is retired after cutover | Same token, only calls `sendMessage` |
| 2026-09-30 | History of every generated/sent state. Audit log of every change | |
| 2026-09-30 | ~~Google sign-in with admin approval and per-platoon GC scope~~ → **one shared password** (`APP_PASSWORD`) plus a typed rank and name. Everyone has full access | The user wanted this "for now". The `role`/`subunitId` columns and `assertCanEdit*` checks are kept dormant for individual logins later |
| 2026-09-30 | ~~OTHERS dates compulsory~~ → **optional** | Reverted at the user's request |
| 2026-09-30 | Off-shift camps are ignored and locked. SOL follows the shifts. RF/Extra auto-mark home absence and are never at their own team | These rules came from the user; see §2 |
| 2026-09-30 | Performance: functions pinned to sin1, one-query session lookup, per-request memo (`lib/data/current.ts`), `loading.tsx` skeletons, 30 s client cache | Functions had been running in iad1 against a Singapore database |
| 2026-09-30 | Logo: Corinthian hoplite helmet (`components/logo.tsx`, `app/icon.svg`, `app/apple-icon.png`) | Replaced the sabre |

---

## 4. Known limitations and open items

- **Shared password:** there's no per-person access control, and "who did it" is only the name they typed.
  - Ten failed logins from one IP locks it for 15 minutes, which can lock out a whole camp on shared Wi-Fi.
  - Changing `APP_PASSWORD` signs everyone out.
  - Individual logins are the obvious v2 security item.
- **The re-import** (changed 2026-10-13, on the `whereabouts` branch) updates people in place and by default leaves absences, duties, on-shift and the Telegram chat alone; `--dry-run` shows the plan first. `--with-absences --yes` is the old parallel-run behaviour (the Sheets' absences, duties, on-shift and Telegram chat, then the parity check). See README.
  - Users and history are kept.
  - The physical-camp grouping is re-derived from the camp names, so a manual edit in Structure is lost.
  - After cutover the app is the source of truth: never use `--with-absences` then.
- **Whereabouts projection** (the `whereabouts` branch, 2026-10-14): with `FEATURE_WHEREABOUTS` and `FEATURE_PROJECTION` on, `currentSnapshot` and `generateParadeState` first sync the Telegram timeline into `absence`/`duty`/`camp.on_shift` through `lib/core` (the extracted bodies of `setStatus`, `setCampShift`, `saveDuty`, `endDuty`). With the flags off (production today) it does nothing. A GC's own entries are never overwritten; see `docs/whereabouts-status.md`.
- **Imported RFs aren't linked to roster people.** Their home absences stay as typed in the Sheets ("RF BDK (…)"). New RFs created in the app are linked.
- **No per-person history screen yet.** Closed `absence` rows and `audit_log` hold the data.
- **iPhone Safari wasn't tested in an emulator:** Playwright WebKit segfaults on this Mac when emulating a phone. The iOS date-field fix in `app/globals.css` is based on documented Safari behaviour. Confirm on a real phone.
- **Desktop uses the mobile layout,** centred with a bottom nav. It's fine, but it isn't a desktop design.

---

## 5. v2: where to start

> **Update 2026-10-12:** v2 is under way as **whereabouts** (a Telegram bot + Mini App behind `FEATURE_*` flags) on the `whereabouts` branch. Its progress, rules and next phase are in [whereabouts-status.md](whereabouts-status.md); this section is kept for history.

The user's planned modules, in the order they mentioned them: **report sick handling, MC tracking, leave tracking, transport claims**, and others.

What already helps:
- **MC and leave tracking:** `absence` already keeps every closed row per person, with type, dates, `created_by`, `closed_by` and `duty_id`.
  - v2 mostly needs screens (per-person history, "who's on MC this week", counts per platoon) and perhaps future-dated or planned absences. Today an absence counts from when it's created.
- **Report sick:** likely a workflow (reported → seen at MA/medical centre → MC/light duty result) that ends by creating an `absence`. Decide whether GCs or the soldiers themselves report.
- **Transport claims:** a new domain (claims, amounts, approvals). It probably needs **individual logins** first, because approvals need identities.
- **Individual logins:** likely a prerequisite for anything with approvals or personal data. The dormant `role`/`subunitId` scoping in `lib/authz.ts` is ready to reuse.

Questions to settle when planning v2:
1. Which module comes first?
2. Do soldiers themselves use the app, or only GCs and ASAs? This drives the login design.
3. Has the bot been retired, and is the app now the source of truth, with no more re-imports?
4. Is there any S6/security guidance on storing medical data (MC/report-sick) on Vercel/Neon?

---

## 6. Working on this repo (gotchas)

- **Parity is sacred.** `npm test` must stay green when touching `lib/parade/render.ts` or `compute.ts`.
- **Push after every commit**, to `whereabouts` and `main` (`git push origin whereabouts whereabouts:main`; the user asked, 2026-10-27). If the code needs a migration production lacks, ask to apply it first, then push.
- **`.env.production.local` has only placeholders.** It holds Vercel's `[SENSITIVE]` placeholders except `DATABASE_URL_UNPOOLED`, which the user filled in (production database).
  - Use it only for imports and migrations against production.
  - `next start` loads it automatically, so override `DATABASE_URL`, `AUTH_SECRET` and `APP_PASSWORD` when running a production build locally.
- **Migrations:** `drizzle-kit generate` asks rename-or-create questions that need a real terminal. Answer them by feeding carriage returns through `script -q /dev/null` (the first option is "create").
  - Apply migrations to production **before** pushing code that needs them.
  - New columns should be additive or nullable, so the running deploy keeps working.
- **Local databases:** `sabre_dev` (seeded example data) and `sabre_test` (used by the tests).
- **UI kit:** shadcn on **Base UI** (the `render` prop, not `asChild`). Check `components/ui/*` before using a component.
- **Next.js 16:** read `node_modules/next/dist/docs/` before using new APIs (see AGENTS.md). Cache Components are **not** enabled.
