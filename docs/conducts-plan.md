# Conduct strength lists: plan

Planned 2026-11-02 with the user, not built yet. It replaces the strength lists GCs type into **Commanders of N23** by hand: CPT participating strength, OSE and comd training participants, comd training attendance and IPPT lists. The chat export (Feb–Oct 2026) has about 93 OSE and comd training lists and about 45 CPT strength lists. Sabre already knows nearly every reason a man isn't going.

Whereabouts rules apply: `wb_` tables only, behind a flag, and nothing changes in v1 or the parade state.

## Decisions (the user, 2026-11-02)
- **Lists are posted into Commanders of N23** by @sabreopsbot. The bot has to be added to that chat and allowed to post. Privacy mode stays on: it posts and never reads. That chat has to be linked, like `/here`, because it isn't a platoon or COY HQ chat.
- **Status men are listed inline with their reason**, e.g. `7. LCP ANSHUM (LD 180626-190626)`, and **not counted** in the participating number.
  - Why: of the 61 CPT lists with names in the chat, 8 list status men inline and 2 put them in a separate "Not participating" block (Bedok 23/03 and HDN 28/04). The other 51 show none.
  - Of the 6 inline lists, 4 leave them out of the count and 2 count them in.
- **Who sets up a conduct:** PS and above (PS, PC, 2IC, OC, CSM), plus ASA and ADMIN. A GC only reports or names his own camp's men.
- **No conducts in ROT.** CPT, OSE and comd training don't run in ROT, so conducts are offered only in the Vigilance phase.

## Format
The most common one in the chat (Ilyas's and Fitri's). Every man is listed by role, and anyone not going gets the reason in brackets. Dates are DDMMYY, as on the parade state.

```
180626 CPT PARTICIPATING STRENGTH

BDK (14/20)

GC: 03/04
1. 3SG JAYVEN
2. 3SG HAKIMI
3. 3SG FITRI
4. 3SG NAZIM (MA @CGH)

CBT: 05/08
...
```

OSE and comd training follow their existing template: date, title and team, then `Participants`, `Total Strength`, and per platoon a count, camps and names.

## Where the reasons come from
- **Filled in by Sabre, out:**
  - AL, OL, OFF, MC and HL, with dates;
  - RF, MA (with the place), RSI and RSO, and course or IPPT events.
  - Never a diagnosis.
- **Filled in by Sabre, not taking part:** a live status (LD and the like).
- **Added by the GC:** Driving, Mounting, or Something else (typed).
- A GC's tap applies to this list only. It never touches the parade state or anyone's records, the same rule as Camp check.

## Slices
1. **Strength list, no setup.** 🧪 Built 2026-11-02, pushed.
   - Manpower (Day, today, a guardroom, Vigilance) › **Strength list for a conduct** opens `/tg/manpower/strength?camp=<id>`: the camp's men now, by role, pre-filled. The GC taps only the differences (Driving, Mounting, IPPT, MA, Going after all, or typed) and copies the text. The conduct's name is editable (default CPT PARTICIPATING STRENGTH).
   - Who: whoever sees that camp on Manpower (`campAccess(...).forecast`). Nothing is saved: no migration, no flag beyond `FEATURE_WHEREABOUTS`.
   - Code: the text and the parade-state helpers are pure in `lib/wb/domain/strength-list.ts` (tests: `tests/wb/strength-list.test.ts`); the read is `lib/wb/strength-data.ts`; the screen is `components/tg/strength-list.tsx`.
   - Reasons, first that applies: an approved or recorded absence on the timeline (MA with its place, an event's name); Extra/RF at another camp; the parade state's own entry, **only while its dates cover now** (v1 keeps ended ones until a GC clears them); a report sick today with no outcome (RSI/RSO). A live status is kept apart (LD) and not counted.
   - Checked in the browser pane at 375 px on `sabre_dev` (SLR): ended September MCs left out, Driving and Going after all change the count and the message, Copy copies the message. Not checked on a phone or with real roles (the dev roster has none, so it shows one OTHERS group).
2. **Conducts** (migration 0016: `wb_conduct`, `wb_conduct_camp`, `wb_conduct_man`; `FEATURE_CONDUCTS`).
   - **Set up:** a PS or above sets one up: kind, date, report-strength time, and camps (off-shift camps that day come pre-ticked from the shift patterns). Who is in it: everyone in the camp, commanders only, or GCs name them.
   - **Tell the GCs:** each camp's GC gets a DM when it's set up.
   - **Report:** his report goes to Commanders of N23 as the text above.
   - **Roll-up:** the PS sees which camps have reported, the totals by role, and the reasons. **Nudge** DMs a GC who hasn't reported, and **Copy coy total** copies the summary.
   - **No cron:** Vercel Hobby crons run daily, so nothing fires at the report time by itself. The DM at setup and the Nudge button replace the "send CPT strength once bus move off" reminders.
3. **Named lists** (OSE, comd training, IPPT).
   - Each GC ticks his men; anyone away that day gets a warning, but can still be picked.
   - Sabre builds the coy list in the existing template, shows which camps haven't named anyone, and posts it to Commanders of N23.
