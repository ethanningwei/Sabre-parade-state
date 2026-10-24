# After Ops Vigilance: ROT and Ops Bacinet

Planning only: nothing here is built yet. These notes come from the user's brainstorming between 2026-10-21 and 2026-10-24, with the decisions they've made so far. Read [whereabouts-status.md](whereabouts-status.md) first: everything here builds on whereabouts and its rules. Those rules are feature flags, additive-only tables, parity on the Vigilance parade state, and v1 edits only with approval.

**Mockups:** [ROT & Bacinet screens](https://claude.ai/artifact/7jUYBZNf4Z744Abvf4SrRK) has 15 phone screens: the changeover, ROT and Bacinet. It's a private canvas (ask the user if you can't open it). Names on it are placeholders, and anything in [brackets] is unknown.

## 1. The phases

| Phase | What the company does | Shape |
|---|---|---|
| **Ops Vigilance** (now) | Mans the guardrooms | Platoons → camps (teams on shifts); GC / ST CBT / ST SVC; RF / Extra / SOL; minimum manning |
| **ROT** (rotational training, about 2+ months) | Trains at **Clementi**, **5 days in, 2 out** | Probably **5 platoons → several sections each**; combat troopers only |
| **Ops Bacinet** | Mans **Jurong Island** and **Sembawang Wharf** | Two areas → posts → teams that take turns; **shifts are back** |

**No start dates yet.** The "Sabre Coy" Google Calendar has nothing on either, as of 2026-10-24.

**After Vigilance there are no service troopers.** All SVC troopers, including the 70/26 ST SVC intake of 26–30 Oct, stay until the end of Ops V. They are **removed from the roster during the changeover**.

**Size estimate** (preview copy of 19 Oct, 211 active):

| | Today | ROT |
|---|---|---|
| COY HQ (OC, CSM, 4 ASAs, 9 PCs, 6 PSes) | 21 | 21 |
| Combat troopers in platoons (72 CBT + 23 GC) | 95 | 95, **about 19 per platoon** |
| SVC troopers | 95 | 0 |
| **Total** | **211** | **116** |

The 23 GCs (future SCs) come to about 4–5 per platoon, so a platoon is roughly 3 sections of about 6, or 4 of 4–5.

## 2. Decided for ROT (the user)

- **Format:** the parade state follows the platoons, not the guardroom format. Each platoon has sections inside it.
- **Confirmed shape:**
  - Vigilance's header, CAA line and strength summary;
  - COY HQ as today;
  - per platoon, `• Total strength / • Present strength`;
  - then each `SECTION n` with `• Total Strength / • Present Strength / • Absentees (MC, AL, etc)` and numbered absentee lines, as today;
  - **no Platoon HQ block**;
  - **no Off Shift and no RF**.
  - The exact text waits on a real sample (§4).
- **Absences:** the same as today. **Statuses (LD and so on) are not absences**, as now.
- **Extras and SOL:** may still exist, but they're served in Clementi, so on weekdays they **don't change the parade state**. There's probably no Extra/SOL section on weekdays. They might only matter on out days.
- **Out days:** the app's job is to produce a correct parade state. Whether one is generated or sent on an out day is up to the ASAs.
- **PCs and PSes:** where they sit isn't decided. **Assume COY HQ** for now, which is where they already are. A PS still approves for his own platoon: grants don't depend on where a man sits on the roster.
- **Roles:** **GC becomes SC** (section commander), and there may be more PSes.
- **SC permissions mirror today's GC:**
  - sees his own section's records, Manpower and the Roster;
  - can "Add for several men" for his section;
  - **approves nothing**; approvals stay with **PS and above**, by platoon, as today.
  - A GC can't report sick or book an MA for his men today. "Report for your men" (whereabouts-status §3c) would add that for GCs, and SCs would inherit it.
- **Sending:** to the same chat at the same times. The **Sheets-based parade-state bot stops**, and the parade state is **sent through @sabreopsbot** (the whereabouts bot, `WB_BOT_TOKEN`). That means:
  - @sabreopsbot must be added to the parade-state chat;
  - v1's send (today `TELEGRAM_BOT_TOKEN`) switches over, which is **a v1 edit that needs the user's approval**.
- **No Google Sheet in ROT:** the app is the only roster source, and `npm run import` no longer applies.
- **The Mini App is assumed live** for the whole company by ROT.

## 3. The changeover (decided shape)

Prepare everything as a **draft** without touching the live parade state, then **switch manually in one step**. **Switch back** the same day undoes it, because nothing is deleted.

1. **Before:** ROT mode is built behind a per-company **phase** setting (Vigilance / ROT / Bacinet) and rehearsed on the preview against a hand-written ROT parade state.
2. **Draft structure:** PLATOON 1–5 and their sections (placeholder names until §4 #2), and SC grants per section.
3. **Assign men to sections:** **anyone in COY HQ** (everyone whose roster person is in COY HQ; there are no drivers or storemen), plus admins. Three ways:
   - **a section at a time**: tick many men, filtered by their current camp, and add them;
   - **"move all of camp X here"**, when a team becomes a section as it is;
   - **paste the Telegram list**. This is likely the main way in, since the sections will probably be announced as a Telegram message rather than an ORBAT:
     - headers (`PLATOON 1`, `Section 2`) set where everyone below them goes;
     - names are matched like registration does;
     - a check screen shows matched / not sure / not on the roster / missing before anything is saved;
     - a later paste only changes the men it names.
   - The screen shows "118 / 146 assigned". **Switch to ROT** stays locked until every man has a section. There's a **preview** of the ROT parade state from the draft.
4. **Switch to ROT** (one confirmation) does all of this together:
   - moves men into their sections;
   - **removes every SVC trooper from the roster** (the same cleanup as ORD or Remove from roster);
   - switches the guardroom camps off (kept as history);
   - ends open Extra/RF/SOL;
   - hides Shifts, HOTO, RF requests and Camp check;
   - replaces GC grants with the drafted SC grants.
   - It keeps running MC, leave and courses, pending requests, records and old parade states.
5. **History:** old parade states and records still show the camp a man was in at the time.

**Bacinet later** works the same way:
- areas → posts → teams drafted in advance;
- men placed the same way;
- **shift patterns and minimums drafted per post**, reusing Vigilance's shift machinery (switched off for ROT, not deleted);
- HOTO and a "Post check" (Camp check) come back.

## 4. Still unknown

| # | What | Blocks |
|---|---|---|
| 1 | **A real ROT parade state** (the user will provide it later) | The ROT format and its golden test |
| 2 | Platoon and section names, and how many sections | Final names (placeholders work until then) |
| 3 | Do PCs and PSes stay in COY HQ or move under their platoons? | Where they print (assume COY HQ) |
| 7 | When the last Vigilance and first ROT parade states go out, and any block leave in between | When to switch; not important yet |
| 14 | The Telegram section list itself (names blurred is fine) | Building and testing the paste reader against the real format |
| — | The Bacinet parade state format, posts, and shift patterns | All Bacinet format work |

## 5. Suggested build order

1. **Phase setting + ROT parade-state format**, behind the setting. Keep `lib/parade` Vigilance output byte-for-byte (parity). Add the ROT format alongside it. **Waits on #1.**
2. **Changeover screens:** draft structure, assigning men (incl. pasting the list), preview, Switch / Switch back, with the SVC removal inside the switch. These can start now with placeholder names.
3. **SC role:** add `SC` to `WB_ROLES` (adding an enum value is additive); give it GC's reach, at section level.
4. **Hide Vigilance-only features by phase:** shifts, minimums, HOTO, RF requests, Camp check, and the evening "below minimum" lines.
5. **Sending through @sabreopsbot:** a v1 edit, so ask first.
6. **Bacinet:** once its format and posts are known.

Each changes the data model (a phase setting, sections, draft assignments), so plan the tables first. All new tables are `wb_`-prefixed and additive: **never ALTER a v1 table**.
