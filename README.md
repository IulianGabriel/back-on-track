# Check It

A personal checklist app (PWA) to rebuild good habits, one step at a time.

- **Daily** and **Additional** (weekly or longer) checklists that you write yourself.
- All checkmarks reset every night at **00:00 Romanian time**.
- **Google sign-in**; tasks are saved to your Firebase account and sync between phone and PC.
- Works offline; changes upload when you're back online.
- **Download backup / Restore backup** buttons for an extra copy of your data.
- Installable: on your phone, open the site and choose *Add to Home screen*.

## How it's built

Plain HTML, CSS and JavaScript with no build step. Firebase (Auth + Firestore) stores the data;
GitHub Pages hosts the files.

| File | What it does |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | The look |
| `app.js` | Checklists, daily reset, edit mode, backups |
| `db.js` | Google login and saving to Firestore |
| `firebase-config.js` | Which Firebase project to use |
| `firestore.rules` | Security rules: only you can read or write your data |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and work offline |
