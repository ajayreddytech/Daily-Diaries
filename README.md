# Daily Diaries

**A calm, private daily page for gratitude, letting go, and planning the hours ahead.**

Daily Diaries turns the end of every day into a short, structured ritual: name what you are grateful for, release what weighed on you, and plan the next day by sorting your commitments by priority. Then rate the day and submit the page. It is one page a day, installable on any phone or laptop, and every entry is private to the person who wrote it.

---

## Why it matters

Most productivity tools manage tasks. Most journals capture feelings. Very few connect the two. Daily Diaries sits where they meet:

- **Gratitude** trains attention toward what is going well.
- **Letting go** gives frustrations a place to land on paper, so they stop circling in the head.
- **A priority-based blueprint** turns a long list of to-dos into a short, honest plan for the hours ahead.
- **A day rating** gives a simple, honest look back over time.

It is built for people who want a small, consistent habit, not another dashboard to maintain.

## The experience

- **One page a day.** Quote of the day, gratitude, letting go, the blueprint, the day rating, and submit. Nothing else competes for attention.
- **Speak or type.** Every writing box has a microphone. Speak an entry, stop the mic, and it appears as a tidy line.
- **Calm, night-sky design.** A dark, animated sky, soft glows, and a single accent system. Medals and buckets each have their own colour and pace.
- **Works like an app.** Install it to your home screen (Android, iPhone or desktop). It opens full screen with no browser bar.

## Features

### Daily page
- **Quote of the day.** 365 quotes, one for each day of the year.
- **Gratitude.** Speak or type entries. Each one is tidied up (capitals, punctuation, common spelling and speech slips, repeated words) and added as a starred line. A sentence that starts "I'm grateful to..." is split into its own entry.
- **Letting go.** The same flow for frustrations and resentments. Write them out, then let them go.
- **Edit with care.** Each list has an edit button in the card header. Change any line, delete what you no longer need, then tap save. Edits are tidied too.

### Pre-performance blueprint
- **Dump.** Capture every task the moment it comes to mind, by typing or speaking.
- **Prioritise.** Give each task one of four buckets: **High**, **Medium**, **Low**, or **No priority / Whenever**.
- **Buckets.** Review one bucket at a time. Drag to reorder, or move a task between buckets. Swipe sideways on a phone.
- **Carry forward.** Open tasks stay on your list until you finish them. Each carried-over task says how long it has been waiting: *From yesterday*, *From the day before yesterday*, *From 5 days ago*, *From 2 weeks ago*.
- **Completed today.** Finished tasks move out of the way and can be restored with one tap.
- **Manage all tasks.** One place to edit wording, reorder, re-prioritise or delete everything at once.
- **Past days.** Browse any earlier day to see the blueprint as it stood that day. Past days are read only.

### Rating the day
Rate each day with a medal:

| Medal | Meaning |
| --- | --- |
| Diamond | Standout day: something was achieved, and it made a difference. |
| Golden | Best day: everything was used well, and you feel happy. |
| Silver | Average day: some done, nothing spent, nothing bad. |
| Rusty iron | Wasted day: a flop. |

Tap a medal to rate the day, tap it again to clear. On laptop, hovering a medal lights its border and speeds up its animation. On a phone, pressing and holding does the same.

### Navigation
- Move between days with the arrows, or jump back to today.
- The top bar shows the date (for example *Wed, Nov 18*), with *Today* underneath on today's page.

### Under the hood
- **Private by design.** Each signed-in user can read and write only their own data (see `firestore.rules`).
- **Nothing stored in the browser.** No `localStorage` or `sessionStorage`. Data lives in Cloud Firestore, so every device stays in sync.
- **Sign in with Google.** No passwords to manage.
- **Installable and resilient.** A service worker caches the app shell, so the app opens quickly and loads even on a weak connection. Your data syncs when you are back online.
- **No build step.** Plain HTML, CSS and JavaScript modules. Easy to read, easy to host, easy to change.

## Technology

| Layer | Choice |
| --- | --- |
| Interface | HTML, CSS and vanilla JavaScript (ES modules) |
| Authentication | Firebase Authentication (Google sign-in) |
| Data | Cloud Firestore, with per-user security rules |
| Voice input | Web Speech API (Chrome, Edge and Safari) |
| Installable app | Web app manifest and a service worker |
| Hosting | Netlify (configured in `netlify.toml`) |

## Project layout

```
index.html            App shell (all screens)
css/styles.css        Dark theme, animations, responsive layout
js/app.js             Auth, Firestore sync, voice input, tidy-up, blueprint, rating
js/quotes.js          365 quotes, one per day of the year
js/firebase-config.js Your Firebase web config (you edit this)
manifest.json         PWA manifest (standalone, full screen)
sw.js                 Service worker (offline app shell)
icons/icon.svg        App icon
firestore.rules       Per-user security rules
firebase.json         Firestore config (rules only)
netlify.toml          Netlify hosting config
```

## Data model

| Path | Contents |
| --- | --- |
| `users/{uid}/days/{YYYY-MM-DD}` | `gratitudeItems`, `frustrationItems`, `rating` (`wasted` / `average` / `best` / `gold`), `submitted`, `submittedAt`, `updatedAt` |
| `users/{uid}/tasks/{taskId}` | `text`, `priority` (`urgent` / `normal` / `okay` / `whenever` / `null` = not yet prioritised), `order`, `status` (`open` / `done`), `createdOn`, `doneOn` |

Tasks are not tied to a date. Open tasks carry forward automatically, and completed tasks leave the active list.

---

## Getting started

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and create a project.
2. **Build > Authentication > Get started > Sign-in method > Google**: enable it and set a support email.
3. **Build > Firestore Database > Create database** (production mode is fine; the rules file locks it down).
4. **Project settings > Your apps > Add app > Web (`</>`)**: register the app and copy the `firebaseConfig` values into `js/firebase-config.js`.
5. **Authentication > Settings > Authorized domains**: add `localhost` for local testing, and your Netlify domain after you deploy. Google sign-in fails on any domain not listed here.

### 2. Run locally

Firebase modules need a web server (not `file://`). From this folder:

```bash
npx serve .            # or: python -m http.server 5000
```

Open the printed URL, sign in with Google, and start writing.

### 3. Deploy

**A. Security rules (Firebase)**, once, and again whenever `firestore.rules` changes:

```bash
npm install -g firebase-tools
firebase login
firebase use --add     # choose your Firebase project
firebase deploy --only firestore:rules
```

**B. Website (Netlify):**

1. Go to <https://app.netlify.com> and sign in.
2. **Add new site > Deploy manually**, and drag the project folder onto the page. Or use **Import an existing project** to redeploy on every push. The settings are already in `netlify.toml`.
3. Copy the site URL, for example `https://your-site.netlify.app`.
4. In the **Firebase Console**, add that domain (without `https://`) under **Authentication > Settings > Authorized domains**. Without this, Google sign-in fails with `auth/unauthorized-domain`.

### 4. Install it

- **Android (Chrome or Edge):** menu > *Install app*, or *Add to Home screen*.
- **iPhone (Safari):** Share > *Add to Home Screen*.
- **Desktop (Chrome or Edge):** the install icon in the address bar.

## Browser support

- Everything works in current Chrome, Edge, Safari and Firefox.
- Voice input needs the Web Speech API, which Chrome, Edge and Safari support. In Firefox the microphone buttons are disabled.
- Speech is processed by the browser's speech service, the same as any dictation feature.

## Privacy

Daily Diaries stores entries only in your own Firestore data, behind Google sign-in. The app does not use analytics or advertising. The text tidy-up runs entirely in your browser. Voice input is handled by your browser's speech service.
