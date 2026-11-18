# Daily Diaries

A dark-mode, installable diary: one fresh page a day with a quote, gratitude,
release, a task blueprint and a day rating. All data lives in Cloud Firestore.
Nothing is stored in localStorage or sessionStorage.

## Project layout

```
index.html            App shell (all screens)
css/styles.css        Dark theme, responsive layout
js/app.js             Auth, Firestore sync, voice input, task manager, rating
js/quotes.js          365 quotes, one per day of the year
js/firebase-config.js YOUR Firebase web config (edit this)
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
| `users/{uid}/days/{YYYY-MM-DD}` | `gratitude`, `frustrations`, `rating` (`wasted` / `average` / `best` / `gold`), `submitted`, `submittedAt`, `updatedAt` |
| `users/{uid}/tasks/{taskId}` | `text`, `priority` (`urgent` / `normal` / `okay` / `none` / `whenever` / `null` = decide later), `order`, `status` (`open` / `done`), `createdOn`, `doneOn` |

Open tasks carry forward automatically because they are not tied to a date.
Completed tasks leave the active list and appear under "Completed today".

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and create a project.
2. **Build > Authentication > Get started > Sign-in method > Google**: enable it and set a support email.
3. **Build > Firestore Database > Create database** (production mode is fine; the rules file below locks it down).
4. **Project settings > Your apps > Add app > Web (`</>`)**: register the app and copy the `firebaseConfig` values into `js/firebase-config.js`.
5. **Authentication > Settings > Authorized domains**: add `localhost` for local testing, and add your Netlify domain (for example `your-site.netlify.app`) after you deploy. Google sign-in fails on any domain not listed here.

## 2. Run locally

Firebase modules need a web server (not `file://`). From this folder:

```bash
npx serve .            # or: python -m http.server 5000
```

Open the printed URL, sign in with Google, and start writing.

## 3. Deploy to Netlify (website) and Firebase (database rules)

**A. Deploy the security rules to Firebase** (one time, and again whenever `firestore.rules` changes):

```bash
npm install -g firebase-tools
firebase login
firebase use --add     # choose your Firebase project
firebase deploy --only firestore:rules
```

**B. Deploy the website to Netlify:**

1. Go to <https://app.netlify.com> and sign in.
2. **Add new site > Deploy manually**, then drag the whole `DailyDiaries` folder onto the page.
   Or, to redeploy on every push, put the folder in a GitHub repo and use **Add new site > Import an existing project**. The settings are already in `netlify.toml`, so leave build command and publish directory as they are.
3. When it finishes, copy the site URL (for example `https://your-site.netlify.app`).
4. In the **Firebase Console**, go to **Authentication > Settings > Authorized domains** and add that Netlify domain (without `https://`). Without this step, Google sign-in fails with `auth/unauthorized-domain`.

## 4. Install it on your phone or laptop

- **Android (Chrome/Edge):** menu > *Install app* (or *Add to Home screen*).
- **iPhone (Safari):** Share > *Add to Home Screen*. It opens full screen with no browser bar.
- **Desktop (Chrome/Edge):** the install icon in the address bar.

## Voice input

The mic buttons use the browser's Web Speech API and show text live as you speak.
Chrome, Edge and Safari support it. Firefox does not, so the mic is disabled there.
Speech is sent to the browser's speech service, the same as any dictation feature.

## Notes

- Sign-in state is kept in IndexedDB by Firebase Auth. No cookies are required.
- Firestore's offline cache also uses IndexedDB. Writes made offline sync when you reconnect.
- Quotes are a fixed list in `js/quotes.js`. Day N of the year shows quote N (cycling every 365 days).
- Attributions for well-known quotes are commonly cited; double-check any you plan to publish.
