# Scenario-Based Training Task System

A mobile-browser grading tool for the Dublin Police Department **Scenario-Based
Training Task Sheet**. It digitizes the paper form and is built around grading an
**entire scenario day** (6–10 scenarios), not individual scenarios.

## How it works

1. **Setup** — Start a new training day, enter the officer, badge number, and
   observing trainers, then pick the day's scenarios from the dropdown
   (the scenario library is editable in Settings). The scenarios stay attached
   to the record so you can always look back at what the day covered.
2. **Notes** — After each scenario, jot quick observations and tag them to a
   scenario. The tool scans each note for keywords and **recommends which
   checklist lines to grade** (e.g. a note mentioning "probable cause" or
   "double lock" highlights the matching Legal Foundation / Arrest lines).
3. **Grade** — At the end of the day the trainers get together and vote each
   line **Pass / Fail / N-O (not observed)**. Turn on **Vote mode** for a
   tap-per-trainer tally — the majority sets the result and ties stay
   unresolved. Not every line has to be graded; ungraded and N/O lines simply
   don't count. A filter shows only the recommended lines.
4. **Results** — A weighted total is computed automatically, with a category
   breakdown, critical-failure flags, the scenario list, all notes, and
   copy/print export. Finalizing locks the record.

## Weighted grading

Every line has a weight:

| Weight | Meaning | Examples |
|--------|---------|----------|
| ×3 Critical | Safety, legal authority, use of force | Miranda, weapon control, ceased force when controlled |
| ×2 Core | Standard performance expectations | Radio traffic, report writing, separating parties |

**Day score = weighted points passed ÷ weighted points graded.** The day passes
when the score meets the threshold (default 80%, adjustable in Settings) **and**
no ×3 Critical line was failed. Weights live in `js/data.js` and are easy to tune.

## Running it

It's a static site — no server, no build step. Grades and notes are saved in the
browser (localStorage) on the device that entered them.

- **On the web:** enable GitHub Pages for this repo (Settings → Pages → deploy
  from branch) and open the URL on your phone. Use "Add to Home Screen" for an
  app-like experience.
- **Locally:** just open `index.html` in any browser.

## Customizing

- **Scenario library** — edit in the app under Settings → Scenario Library
  (the defaults in `js/data.js` are placeholders — replace them with your
  department's actual scenario list).
- **Line weights & note keywords** — edit `js/data.js`.
- **Passing threshold** — Settings → Grading.
