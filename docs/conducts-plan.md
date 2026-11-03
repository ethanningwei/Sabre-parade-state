# Conduct strength lists: plan

Planned 2026-11-02 with the user. Slices 1 and 2 are built and pushed; slice 3 is built (below). It replaces the strength lists GCs type into **Commanders of N23** by hand: CPT participating strength, OSE and comd training participants, comd training attendance and IPPT lists. The chat export (Feb–Oct 2026) has about 93 OSE and comd training lists and about 45 CPT strength lists. Sabre already knows nearly every reason a man isn't going.

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

OSE and comd training follow their existing template: date, title and team, then `Participants`, `Total Strength`, and per platoon a count, camps and names (slice 3, below).

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
3. **Named lists** (OSE, comd training, IPPT). 🧪 Built 2026-11-03, not pushed (waiting on migration **0017** for production). Migration **0017** (`wb_conduct`: `kind`, `team`, `due_date`, `text`, `chat_id`, `thread_id`, `message_id`; all additive, old rows become `STRENGTH`) on `sabre_dev` and `sabre_test`. Behind `FEATURE_CONDUCTS`.
   - **The format**, from the chat export: 93 OSE & comd training lists over 11 conducts, each a chain where Syafiq posts the empty template and every GC reposts it with his names (4491 → 4632, 8324, 9368). In all 93, Total Strength and the Plt counts were left blank; a camp that named nobody wrote `NIL`.
     ```
     120826 OSE & COMD TRAINING
     (Team A)

     Participants

     Total Strength: 21

     Plt 5: 6

     HDN:
     LCP CASEY

     TFT:
     NIL
     ```
     Sabre fills in the counts (a platoon's once any of its camps has sent). A waiting camp keeps a blank heading. Camps go by Sabre's name (`SRF B`, where the chat writes `SRF`). Names are trimmed and in role order (GC, CBT, SVC, then others). No reasons in the post.
   - **Decisions (the user, 2026-11-03):**
     - set-up **posts the empty list** into Commanders of N23, and every camp's send **edits that one post** ("Updated HHMMH");
     - camps still waiting are shown **in the app only** (the roll-up), never as an extra line in the post;
     - **IPPT uses the same template** (type IPPT as the title); the export has no named IPPT list from Vigilance;
     - **7 days ahead** at most, as for a strength; names are due by **a day and a time** (default the day before, 1800), and a GC can send until the end of the conduct's day.
   - **Defaults taken with the plan (approved 2026-11-03):**
     - **Away that day:** anything touching 0000–2359 of the day warns: an approved or recorded absence, a pending one (`AL … pending`), Extra/RF elsewhere, a parade-state entry covering any part of it, a live status. An undated parade-state MA counts only today (it's that day's appointment); other undated entries (MP60, a course) count. RSI/RSO only when the day is today. A warning only: he can still be picked.
     - **Pre-ticked:** every camp with no partner team, and of each pair the team off at 1200 that day (SRF's 7/7 team too). The Team line is the team most ticked pairs belong to (none on a tie), editable A / B / None.
     - **Cancel** DMs the GCs still waiting and edits the post with "❌ Cancelled HHMMH".
     - No "commanders only" mode (the GC ticks his commanders); a comd training *attendance* list isn't part of it.
     - Who: as slice 2 (`conductAccess().setUp` sets up, nudges, cancels; `reportsFor` names a camp's men).
   - **Set up** (`/tg/conducts/new`): **Strength (CPT)** or **Named list** at the top. Named: title `OSE & COMD TRAINING`, Team, Day, Names due on (today to the day) and by, camps by `namedPreTicked`. The GCs' DM has a **Name SLR's men** button (`conducts/camp/<id>`).
   - **Name your men** (`/tg/conducts/camp/[id]`, `components/tg/named-list.tsx`): the camp's men by role with checkboxes; an away man shows "AL 051126 · away that day" (amber), and "picked though away" once ticked. Send / Send again; **Nobody from SLR** (confirm) sends NIL; a preview of the camp's lines and **Copy coy list**. Blocked once cancelled or after the day.
   - **Roll-up** (`/tg/conducts/[id]`): N named, camps named (or NIL) or waiting with Nudge, By platoon, **Picked though away**, Copy coy list (the post's text), Cancel. The list tags it "Named". Needs you: "Name SLR's men · due 041126 1800H" from set-up until he sends.
   - **Concurrency:** a send locks the `wb_conduct` row, rebuilds the coy list from every camp inside the transaction and stores it in `wb_conduct.text`; the edit afterwards re-reads the newest text, so two GCs sending at once still leave the post right. With no chat at set-up, the first send posts it (and keeps the ref only if no other send got there first); a post Telegram won't edit is posted again.
   - **Code:**
     - pure: `lib/wb/domain/named-list.ts` (`namedListText`, `namedPreTicked`, `teamFor`, `byRole`, `plt`, `manLine`, `namedAskText`, `dueLabel`); `conductInput` (kind, team, dueDate) and `cancelledText` in `domain/conducts.ts`; `v1CoversDay` in `domain/strength-list.ts`; Needs you's `names` line;
     - reads: `strengthOn(campId, date)` in `lib/wb/strength-data.ts` (shares `strengthFor`'s body); `namedText`, and the named fields in `conductView`, `conductCampView`, `openReportsFor` (`lib/wb/conduct-data.ts`);
     - writes: `reportNames`, and the named branches of `setUpConduct`, `nudgeConductCamp`, `cancelConduct` (`lib/wb/conducts.ts`); action `sendNames`.
   - **Tests:** `tests/wb/named-list.test.ts` (the text word for word, pre-ticks, team, the form, `v1CoversDay`, the DM, Needs you); the named-list block in `tests/wb/conducts.db.test.ts` (template at set-up, names editing the one post, NIL, warnings, no chat, the day, cancel, nudge, Needs you, `strengthOn`). 854 tests.
   - **Checked** in the browser pane at 375 px on `sabre_dev` (`FEATURE_CONDUCTS=1`, throwaway token, offline): set-up pre-ticked SFT A, OSU A, PYAD A, SRF B and every single camp with Team A; the template as stored; SLR with an AL on the day (warned, picked anyway), Send ("not linked yet"); TFT Nobody → NIL; the roll-up's counts, By platoon and Picked though away; Cancel. Found and fixed on the way: an undated parade-state MA warned for every future day; a roster name's stray space reached the list.
   - **Not yet checked:** the real post and its edits in Commanders of N23, a GC's DM and Needs you on a phone (dev has no GCs on Sabre).
   - **Rollout:**
     1. apply 0017 to production **before** the push (Conducts' screens read the new columns even for a strength);
     2. push to `whereabouts` and `main`, flag still off;
     3. with slice 2's steps 3–4 done (bot in Commanders of N23, `FEATURE_CONDUCTS=1`), use it for the next OSE.
