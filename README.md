# Scenario-Based Training Task System

A mobile-browser grading tool for the Dublin Police Department **Scenario-Based
Training Task Sheet**. It digitizes the paper form and is built around grading an
**entire scenario day** (6–10 scenarios), not individual scenarios.

## How it works

1. **Setup** — Start a new training day, pick (or create) the officer being
   evaluated, add the observing trainers by name, then pick the day's scenarios
   from the dropdown. The scenarios stay attached to the record so you can
   always look back at what the day covered.
2. **Notes** — Every scenario on the day gets its own **bullet list**. After
   each scenario, add short observations (typed or dictated with the 🎤
   button); each new line becomes its own bullet. The tool scans each bullet
   for keywords and **recommends which checklist lines to grade** (★ Note
   match). Bad suggestion? Dismiss it, per bullet or for the whole line.
3. **Grade** — At the end of the day the trainers vote each line
   **Met Standard / Needs Improvement / N-O (not observed)**. Recommended bullets show under the
   line; tap **＋ Link** to tie a bullet to that line, or use **🔗 Link
   observations** to pick any bullet from any scenario. Linked bullets print
   in the line's Notes column on the official form. In **Vote mode**, votes
   are recorded **by trainer name**: each trainer selects themselves and taps
   👍/👎 per line. The majority sets the result, ties stay open, and every
   trainer's vote shows next to the line. (Internally the app still stores
   these as `pass` / `fail`, so older saved days and synced votes carry over.) Not every line has to be graded —
   ungraded and N/O lines simply don't count.
4. **Results** — A weighted total with category breakdown, flags for any
   Critical line marked Needs Improvement, the scenario list, and export: **print the filled-in official form**
   (save as PDF from the print dialog) or copy a plain-text summary.
   Finalizing locks the record.
5. **Officer profiles (👤 on the home screen)** — every officer gets a profile
   automatically: score trend across training days, days passed, and repeat
   problem areas (lines marked Needs Improvement on multiple days).

## Weighted grading

| Weight | Meaning | Examples |
|--------|---------|----------|
| ×2 Critical | Safety, legal authority, use of force, scene control, de-escalation fundamentals | Miranda, weapon control, slowed the situation, established scene control, separated parties |
| ×1 Standard | Standard performance expectations | Radio traffic, report writing, articulating RAS/PC on a search |

**Day score = weighted points that met standard ÷ weighted points graded.** The
day passes when the score meets the threshold (default 80%, adjustable in
Settings) **and** no Critical line was marked Needs Improvement. Weights live in `js/data.js` and are easy to tune;
`CRITICAL_WEIGHT` there is the single cut-off for the fail-the-day rule.

## Running it

It's a static site — no build step. By default all data is saved in the browser
on the device that entered it.

- **On the web:** enable GitHub Pages for this repo (Settings → Pages → deploy
  from branch) and open the URL on your phone. The app is a **PWA**: use
  "Add to Home Screen" to install it with an icon, and it keeps working offline
  at training sites with no signal.
- **Locally:** just open `index.html` in any browser.

## Shared backend (multi-device sync + live voting)

Optional, but recommended for real department use: with a free
[Supabase](https://supabase.com) project, every trainer sees the same data and
**votes live from their own phone** — tallies update on everyone's screen as
votes come in.

One-time setup (about 10 minutes):

1. Create a free project at supabase.com.
2. Open the project's **SQL Editor**, paste the contents of
   [`supabase-schema.sql`](supabase-schema.sql), and click **Run**.
3. In Supabase, copy the **Project URL** and **anon (public) key** from
   Project Settings → API.
4. In the app on each trainer's phone: **Settings → Shared Backend**, paste
   both values, enter that trainer's name (for vote attribution), and tap
   **Connect**.

Notes:

- Existing local data is pushed up on first connect; devices merge by
  last-write-wins, and votes merge per trainer so nobody overwrites anyone.
- Treat the URL + anon key like a shared department password — anyone holding
  them can read and write the training data.
- Without the backend, everything still works on a single shared device.

## Backups

Settings → Data → **Export backup** downloads everything as JSON;
**Import backup** restores it on any device.

## Customizing

- **Scenario library** — Settings → Scenario Library: add/rename/remove
  scenarios. The defaults are the Dublin PD master list.
- **Line weights & note keywords** — edit `js/data.js`.
- **Passing threshold** — Settings → Grading.
