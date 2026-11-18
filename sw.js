// Service worker: lets the app open even without internet.
// App files: always try the network first (so you get updates), fall back to the saved copy.
// Firebase library files: they never change for a given version, so use the saved copy.
const CACHE = 'back-on-track-v1';
const APP_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'db.js', 'firebase-config.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      }
    })());
    return;
  }

  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
