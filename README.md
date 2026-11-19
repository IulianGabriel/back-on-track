# On Track

A personal app (PWA) to get back on track, one step at a time. It runs in the browser on PC and phone,
and can be installed on the home screen.

**Live:** https://iuliangabriel.github.io/back-on-track/

## What it does

- **Tasks:** Daily and Additional (weekly or longer) checklists you write yourself. All checkmarks
  reset every night at **4:00 AM Romanian time** (the app's day starts at 4 AM, so things done after
  midnight still count for the evening before).
- **Journal:** one entry per day that saves as you type. Move between days with the arrows (or ← → on a
  computer), see what you wrote on the same date in earlier years, and browse past entries.
- **Finance:** savings on card and in cash. Add, spend, or move cash to card, each with an optional note
  and date. A ring chart for the card/cash split, a savings-over-time chart (7D / 1M / 3M / 1Y) and
  what you added and spent this month.
- **Achievements:** your own categories (name + emoji). Each category has its own page with the
  achievements as cards: title, date, description, up to 4 photos (tap for full screen) and up to 5 links.
- **Profile:** your name and photo, your savings, streaks, backups and sign-out.
- **Google sign-in.** Everything is saved to your Firebase database and syncs between devices.
- **Works offline.** Changes upload when you're back online.
- **Backups:** *Download backup* saves everything as a file; *Restore backup* adds it back without
  overwriting anything you've written.

## How it's built

Plain HTML, CSS and JavaScript with no build step. Firebase (Auth + Firestore) stores the data;
GitHub Pages hosts the files.

| File | What it does |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | The look (dark only) |
| `app.js` | Sign-in, bottom navigation, backups, the daily reset check |
| `tasks.js` | Daily and Additional checklists |
| `journal.js` | Journal: one entry per day, day arrows, On this day, past entries |
| `finance.js` | Finance: card and cash savings, add/spend/move, history, charts |
| `achievements.js` | Achievements: categories, achievements and the emoji picker |
| `emoji-data.js` | The list of standard emojis (from the MIT-licensed `unicode-emoji-json` package) |
| `profile.js` | Name, photo, stats, savings |
| `util.js` | Dates (Romanian time, day starts at 4 AM) and small helpers |
| `db.js` | Google sign-in and everything saved to Firestore |
| `firebase-config.js` | Which Firebase project to use |
| `firestore.rules` | Security rules: only the owner's Google account can read or write the data |
| `firestore.indexes.json` | Database index used to list journal entries newest-first |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and work offline |

## Where the data lives (Firestore)

All under `users/{yourUserId}/`:

- `tasks/{id}`: text, section, order, the date it was last checked, and every date it was checked
- `journal/{YYYY-MM-DD}`: that day's text
- `finance/{id}`: one money movement (amounts are stored in bani, 1 RON = 100 bani)
- `meta/finance`: current card and cash totals
- `achievementCategories/{id}` and `achievements/{id}` (with links and small photo thumbnails)
- `achievementPhotos/{id}`: the full-size photos (shrunk JPEGs, loaded only when opened)
- `meta/profile`: name and photo
