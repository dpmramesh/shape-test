# Low Vision Shape Test

A screening tool for people with very low vision (for example 20/500 or worse). It shows moving shapes at chosen sizes, colours and speeds, records what the person can see and identify, and builds a report that tracks progress over time.

It is a **static web app**: plain HTML, CSS and JavaScript. There is no npm, no build step and no server. Host it on GitHub Pages, or open `docs/index.html` directly in a browser. It runs on a laptop, a tablet, or a TV browser (Fire TV Silk, Google TV Chrome).

The app is a screening aid, not a diagnostic test. Interpret the results together with a clinical assessment.

## Quick start

**Open it directly:** double-click `docs/index.html`, or drag it into a browser window. Everything runs locally.

**Host on GitHub Pages:**

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/docs`, then **Save**.
4. After a minute the site is at `https://<your-user>.github.io/<repo-name>/`. Open it on the TV's browser.

GitHub Pages serves over HTTPS, which the browser needs for some features. Nothing else needs configuring.

## What it does

### Setup (before the test)

- **Shapes:** circle, square, triangle, diamond, star, hexagon, cross, heart. Choose any combination.
- **How many of each:** 1 to 20, default 1. The count applies to each selected shape type. Star at 5 shows 5 stars. Star and Circle at 5 shows 5 stars and 5 circles.
- **Fill:** filled, outline, or mixed (random per shape).
- **Colour and background:** eight shape colours and four backgrounds, for contrast testing.
- **Motion:** bounce, sweep (side to side), orbit (circle), or wander (random turns). Speed is a slider from 0 to 1000 px/s, with the equivalent °/s shown.
- **Test type:**
  - *Adaptive:* a 2-down/1-up staircase changes the size automatically and estimates the threshold (the smallest size the person reliably identifies, about 70%).
  - *Fixed:* keep one size for the whole test.
- **Size:** 15 levels from 30° down to 0.5° of visual angle. Sizes convert to pixels using the **viewing distance** and **screen width** you enter, so the numbers mean something clinically.

### During the test

- **Layout and motion:** shapes are spaced as far apart as the stage allows, with a gap of a quarter of a shape's size between neighbours, and none is cut off at the edges. Each shape moves on its own with the chosen motion. Shapes may pass over each other while moving.
- **Overlap check:** before anything is drawn, the app checks that the shapes fit. Setup shows a warning and will not start a test if the starting size does not fit. During the test, a trial that would not fit is held back, and the message says what to change: press `S` for a smaller size, or lower the count. A size change that would make shapes on screen overlap is refused.
- **Responses:** the person names each shape type they see and says how many of it there are. Tap a shape type (or press its number) once for each one counted, then tap **Record answer** (or press `R`). Only the shape types on the current trial are listed. Use **Clear count** (or `C`) to start the count again. `0` records nothing seen, and `U` records seen but not identified. Response time is recorded.
- **Scoring:** a trial is correct only if every shape type shown has exactly the right count, and no other shape type is named. Accuracy by shape counts each shape type in a trial separately.
- **Adjust panel (`A`):** change parameters while the test runs, so you can respond to what the person says:
  - *Shapes*, *count* and *motion*: take effect from the next trial (so the person isn't asked about a shape that changed mid-answer).
  - *Fill*, *colour*, *background*, *speed*, *size* and *calibration*: take effect on the shape on screen now.
  - *Size* moves the staircase level in adaptive mode without counting as a reversal, so you can steer the test by hand.
- **Pause (`P`)** and **hide controls (`H`)** for a cleaner view.
- **End (`Esc`)** shows the results. Save the session to the person's record, or discard it.

Every trial stores the settings in effect when it was shown: shape, size, fill, colour, background, motion, and speed. Changing a setting mid-test is therefore visible in the data.

### People and reports

- Each person has name, age, gender, current vision level, issues and notes.
- Each session keeps its date, settings and every trial.
- **Download report (HTML):** printable report with a progress chart, threshold trend, and accuracy by size and by shape. Open it and use Print to save as PDF.
- **Download trials (CSV):** one row per trial, safe to open in a spreadsheet. `shapes_shown` and `answer` list each shape type with its count, for example `circle:5;star:5`. An answer of `none` or `unsure` is written as is.
- **Download backup / Restore from backup:** all people and sessions in one JSON file. Use it to keep a copy or move records to another device.

## Keyboard and remote

| Key | Action |
|---|---|
| Arrow keys / remote D-pad | Move between buttons and sliders |
| Select / Enter | Press the focused button |
| `1`–`8` | Count one more of that shape type: 1 circle, 2 square, 3 triangle, 4 diamond, 5 star, 6 hexagon, 7 cross, 8 heart (only types on the current trial) |
| `R` | Record the answer with the counts entered |
| `C` | Clear the counts entered for this trial |
| `0` | Nothing seen |
| `U` | Seen but not identified |
| `P` | Pause or resume |
| `A` | Show or hide the Adjust panel |
| `B` / `S` | Bigger / smaller |
| `H` | Hide or show the controls |
| `Esc` or Back | End the test |

## Where the data lives

**Records are stored in the browser's local storage on the device that runs the app.** Nothing is uploaded, and the GitHub Pages site contains only the app code.

This has three consequences:

- Records are per browser and per device. A record made on the TV is not visible on your laptop until you move it with backup and restore.
- Clearing the browser's site data deletes the records. Download a backup first.
- Some TV browsers block local storage. The app then keeps records only until the page closes and shows a warning. Download a backup before leaving.

The backup file is plain JSON with personal health information. Keep it on an encrypted drive, and do not commit it to GitHub. The `.gitignore` already ignores `*.backup.json` and `shape-test-backup-*.json`.

## Calibrate the sizes

In the setup screen, set:

- **Viewing distance:** from the person's eyes to the screen, in cm. Measure it on the day of the test.
- **Physical width of the screen:** in cm. For example, a 65-inch 16:9 TV is about 144 cm wide.

Set the TV to its native resolution, and turn off overscan and any zoom or "fit" scaling. The browser can only report true pixel sizes when the page is not scaled.

## Project layout

```
docs/                    The static app (this is what GitHub Pages serves)
  index.html
  css/app.css
  js/core.js             Shared logic: shapes, motion, staircase, validation, reports, storage
  js/app.js              Screens, live controls, trial loop
tests/static/            Tests for docs/js/core.js
tests/e2e/static-flow.mjs  Browser check of the static app (npm run e2e)
```

## Tests

```powershell
node --test "tests/**/*.test.js"
```

or, with npm, `npm test`. The static-app tests cover the visual-angle maths, shape geometry, motion with live speed changes, the staircase with manual nudges, validation, reports and CSV escaping, and the record store. The store tests use a fake storage object, so they never touch real data. They include failure cases: damaged storage, a full storage, a backup from another app, and a backup with one bad record (which must change nothing).

Browser check (needs Microsoft Edge or Google Chrome installed; skips otherwise):

```powershell
npm run e2e
```

It opens `docs/index.html` straight from disk with no server, creates a person, runs a test, uses the Adjust controls, saves the session, and checks that no JavaScript errors occurred.

`npm` is optional for the app itself. It is only used to run the tests above, and the project has no dependencies to install.

## Security notes

- **No secrets.** The app has no passwords, API keys or tokens, and no configuration to protect.
- **No network calls.** The app never sends data anywhere. Check this yourself in the browser's developer tools (Network tab) if you want to verify it.
- **Personal health data on the device.** Local storage and backup files hold names, ages, vision details and trial results. Protect the device (lock screen, encrypted disk). On a shared TV, use a separate browser profile or sign out of any profile that holds records.
- **Public hosting.** Anyone with the GitHub Pages URL can open the app, but they see only their own local data. The code is public. Do not put personal data in the repository.
- **Randomness.** Trial order and motion use `crypto.getRandomValues`. Record IDs use `crypto.randomUUID()`. Nothing uses `Math.random` for IDs or tokens.
- **Report and CSV safety.** All user text is HTML-escaped in reports. CSV cells that start with `=`, `+`, `-`, `@` or a tab are prefixed with an apostrophe, so spreadsheets show them as text rather than running formulas.
- **Restore safety.** A backup is fully validated before anything is written. A file from another app, or one with a bad record, changes nothing.

## Limits

- Tested in headless Microsoft Edge on Windows. Not yet run on a physical Fire TV or Google TV. Check the Silk and Google TV browsers before a clinical session.
- Sizes are only as accurate as the calibration values entered.
- Shapes are placed on a grid to keep the gaps as large as possible. When there is no room for the gap, the test will not start, or the trial is held back (see Overlap check above). The overlap check uses the full window at setup. The test itself checks the smaller stage, so a size that passes setup can still be held back during the test.
- The threshold needs enough reversals. An adaptive session with too few shows "not enough reversals".
- Downloads depend on the browser. On some TV browsers the file may not save. If so, use the report on a laptop, or record results on paper and enter them later.
