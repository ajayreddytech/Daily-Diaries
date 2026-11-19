# Daily Diaries

**A private, one-page daily journal for gratitude, letting go, and planning the day ahead.**

Daily Diaries turns the end of each day into a short ritual: note what you are grateful for, release what weighed on you, sort tomorrow's tasks by priority, rate the day, and submit the page. It installs to any phone or laptop, and every entry belongs only to the person who wrote it.

## Features

- **Quote of the day.** One of 365 quotes, a different one each day of the year.
- **Gratitude and letting go.** Speak or type entries. Each line is tidied up and saved to your page. Sentences that start with "I'm grateful to..." are starred.
- **Pre-performance blueprint.** Dump your tasks, give each one a priority (High, Medium, Low, or Whenever), and work through the buckets one at a time. Open tasks carry forward until you finish them.
- **Day rating.** Rate each day with a medal: Diamond, Golden, Silver, or Rusty iron.
- **Past days.** Browse earlier pages. Past days are read only.
- **Voice input.** Every writing box has a microphone, using the browser's speech recognition.
- **Installable.** Works as a full-screen app on Android, iPhone, and desktop, and loads offline once cached.

## Tech stack

| Layer | Technology |
| --- | --- |
| Interface | HTML, CSS, vanilla JavaScript (ES modules), no build step |
| Authentication | Firebase Authentication (Google sign-in) |
| Data | Cloud Firestore, with per-user security rules |
| Voice input | Web Speech API |
| Offline and install | Web app manifest and a service worker |
| Hosting | Netlify (see `netlify.toml`) |

## Project structure

```
index.html              App shell
css/styles.css          Theme, animations, responsive layout
js/app.js               Auth, sync, voice input, blueprint, rating
js/quotes.js            365 daily quotes
js/firebase-config.js   Firebase web config (add your own)
firestore.rules         Per-user security rules
sw.js                   Service worker (offline app shell)
manifest.json           Web app manifest
```

## Getting started

### 1. Set up Firebase

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication**: enable the Google sign-in provider.
3. **Firestore Database**: create a database. The included rules restrict each user to their own data.
4. **Project settings > Your apps**: register a web app and copy its config into `js/firebase-config.js`.
5. **Authentication > Settings > Authorized domains**: add `localhost` and, after deploying, your Netlify domain.

### 2. Run locally

Firebase modules need a web server rather than `file://`:

```bash
npx serve .            # or: python -m http.server 5000
```

Open the printed address and sign in with Google.

### 3. Deploy

- **Security rules:** `firebase deploy --only firestore:rules`
- **Website:** deploy the folder to Netlify. `netlify.toml` holds the settings.
- Then add the Netlify domain to the Firebase authorized domains, or Google sign-in will fail with `auth/unauthorized-domain`.

## Data model

| Path | Contents |
| --- | --- |
| `users/{uid}/days/{YYYY-MM-DD}` | Gratitude and letting-go entries, day rating, submission status, timestamps |
| `users/{uid}/tasks/{taskId}` | Task text, priority, order, status (`open` or `done`), dates |

Tasks are not tied to a date, so open tasks carry forward automatically.

## Privacy

Entries are stored only in your own Firestore data, behind Google sign-in. The app uses no analytics or advertising and stores nothing in `localStorage` or `sessionStorage`. The text tidy-up runs in your browser. Voice input is processed by your browser's speech service.

## Browser support

Current Chrome, Edge, Safari, and Firefox. Voice input requires the Web Speech API, so the microphone buttons are disabled in Firefox.
