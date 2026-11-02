# Conduct strength lists: plan

Planned 2026-11-02 with the user. Slices 1 and 2 are built (below). It replaces the strength lists GCs type into **Commanders of N23** by hand: CPT participating strength, OSE and comd training participants, comd training attendance and IPPT lists. The chat export (Feb–Oct 2026) has about 93 OSE and comd training lists and about 45 CPT strength lists. Sabre already knows nearly every reason a man isn't going.

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
2. **Conducts.** 🧪 Built 2026-11-02, pushed with the flag off. Migration **0016** (`wb_coy_chat`, `wb_conduct`, `wb_conduct_camp`, `wb_conduct_man`) on `sabre_dev`, `sabre_test` and **production (applied 2026-11-02)**. Behind `FEATURE_CONDUCTS`.
   - **Decisions (the user, 2026-11-02):**
     - whole camps only ("commanders only" and named lists wait for slice 3);
     - a second send **edits the bot's earlier post** and adds "Updated HHMMH";
     - the coy total stays **in the app** (Copy coy total), and nothing extra goes into the chat;
     - a camp's strength is sent by **its GC (SC), or anyone above him** (his PC/PS, OC/2IC/CSM, an ASA) or ADMIN.
   - **Commanders of N23:** add the bot to the chat and send `/here COMMANDERS` (an ASA, OC/2IC/CSM or ADMIN). It is stored in `wb_coy_chat` and listed in Admin › Commanders' chats, where it can be removed.
   - **Set up** (Home › Conducts › Set up a conduct, `/tg/conducts/new`):
     - for a PC or PS, OC/2IC/CSM, an ASA or ADMIN (`conductAccess().setUp`, the `conducts` screen);
     - fields: the title, the day (today to a week ahead), "strengths due by", and the camps;
     - camps off shift that day are pre-ticked (`preTicked`, from the shift patterns), and COY HQ is never offered;
     - each ticked camp's GC/SC with a Sabre account is DMed with a **Send BDK's strength** button (`conducts/camp/<id>`);
     - the roll-up names the camps with nobody on Sabre to ask.
   - **Send** (`/tg/conducts/camp/[id]`, from the DM or Home's Needs you line "Send SLR strength · due 1830H"):
     - it is slice 1's list with the conduct's title, plus **Send** / **Send again** and Copy;
     - the server rebuilds the men (`strengthFor`) and keeps only the sender's taps;
     - each send stores every man's line (`wb_conduct_man`, a snapshot), and the next send starts from his taps;
     - only on the conduct's day, and not once it's cancelled;
     - with Commanders of N23 not linked (or Telegram failing), the send is still saved and the screen says to copy it in.
   - **Roll-up** (`/tg/conducts/[id]`):
     - camps sent ("Sent 1912H · 3SG X", going/total) or waiting;
     - **Nudge**: a DM to the GC, at most once per 10 minutes;
     - totals by role and who isn't going, with reasons;
     - **Copy coy total** (`TOTAL: 74/86`, then each camp, or "not reported");
     - **Cancel conduct**, which DMs the GCs who haven't sent.
   - **No cron:** Vercel Hobby crons run daily, so nothing fires at the due time by itself. The DM at set-up and Nudge replace the "send CPT strength once bus move off" reminders.
   - **Code:**
     - pure rules: `lib/wb/domain/conducts.ts`;
     - access: `conductAccess`, `reportsFor`, `isCampCommander`, `coyChatAccess` in `lib/wb/domain/access.ts`;
     - writes: `lib/wb/conducts.ts`;
     - reads: `lib/wb/conduct-data.ts`;
     - actions: `lib/wb/actions/conducts.ts`;
     - Courier `post` / `editPost`: `lib/wb/telegram/courier.ts`;
     - `/here COMMANDERS`: `lib/wb/telegram/bot.ts` and `linkCoyChat` in `lib/wb/admin.ts`;
     - screens: `app/(tg)/tg/conducts/`, `components/tg/conduct-form.tsx`, `conduct-rollup.tsx`, and `strength-list.tsx` (its `send` mode).
   - **Tests:**
     - `tests/wb/conducts.test.ts`;
     - `tests/wb/conducts.db.test.ts`;
     - the conduct cases in `access.test.ts` and `needs-you.test.ts`.
   - **Checked** in the browser pane at 375 px on `sabre_dev` with `FEATURE_CONDUCTS=1` and the throwaway token, so offline:
     - set up with off-shift camps pre-ticked;
     - Nudge and its wait;
     - SLR's send screen, with real GC/CBT/SVC roles: Driving, then Send (saved, "not linked"), then Send again;
     - the roll-up's totals, Cancel, and the Needs you line.
   - **Not yet checked:** a real post and its edit in a Telegram group (the throwaway token can't reach Telegram), or on a phone.
   - **Rollout:**
     1. ✅ 0016 applied to production before the push (Admin › Commanders' chats reads `wb_coy_chat` even with the flag off);
     2. ✅ pushed with `FEATURE_CONDUCTS` off;
     3. the user adds the bot to Commanders of N23 and sends `/here COMMANDERS`;
     4. turn `FEATURE_CONDUCTS=1` on in Vercel and redeploy;
     5. a phone check on the next CPT.
3. **Named lists** (OSE, comd training, IPPT).
   - Each GC ticks his men; anyone away that day gets a warning, but can still be picked.
   - Sabre builds the coy list in the existing template, shows which camps haven't named anyone, and posts it to Commanders of N23.
