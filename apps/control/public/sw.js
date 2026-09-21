/* venduá controle — service worker.
   /control/assets/* is vite's content-hashed output: cache-first forever.
   Everything else under /control/ (index.html, manifest, icons, sw.js)
   goes network-first so a deploy lands on the next navigation — the cache
   is the offline fallback, never the source of truth.
   /control/v1 is the API: never intercepted, never cached. */
const CACHE = 'vendua-control-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add('/control/'))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith('/control/') || url.pathname.startsWith('/control/v1')) return;

  if (url.pathname.startsWith('/control/assets/')) {
    e.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((r) => put(request, r))),
    );
    return;
  }

  e.respondWith(
    fetch(request)
      .then((res) => put(request, res))
      .catch(() =>
        caches
          .match(request)
          .then(
            (hit) =>
              hit ?? (request.mode === 'navigate' ? caches.match('/control/') : Response.error()),
          ),
      ),
  );
});
