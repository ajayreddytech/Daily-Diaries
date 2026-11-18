// Daily Diaries service worker: makes the app load offline as an installed PWA.
// Only same-origin GET requests are cached. Firebase / Google traffic is never cached here.
const CACHE = "daily-diaries-v1";
const SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/quotes.js",
  "js/firebase-config.js",
  "manifest.json",
  "icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network first so updates reach you; fall back to the cached copy when offline.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("index.html")))
  );
});
