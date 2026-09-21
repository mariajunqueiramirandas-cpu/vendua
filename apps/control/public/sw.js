/* venduá controle — service worker.
   /control/assets/* is vite's content-hashed output: cache-first forever.
   Everything else under /control/ (index.html, manifest, icons, sw.js)
   goes network-first so a deploy lands on the next navigation — the cache
   is the offline fallback, never the source of truth.
   /control/v1 is the API: never intercepted, never cached.

   One cache per deploy: install reads the bundle hash out of index.html
   (assets/index-<hash>.js) and names the generation after it, so an update
   can never serve the previous shell offline. Cleanup on activate is
   scoped to this worker's vendua-control-* namespace — other apps on the
   origin (storefronts) keep their own caches. */
const PREFIX = 'vendua-control-';
let generation; // set by install — undefined if the worker restarted between install and activate

const currentCache = () =>
  caches.keys().then((keys) => {
    // After activate only the live generation remains; before it, pick the
    // newest (insertion order puts it last) so writes never go to the stale
    // cache that is about to be deleted.
    const own = keys.filter((k) => k.startsWith(PREFIX));
    return caches.open(generation ?? own[own.length - 1] ?? PREFIX + 'boot');
  });

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('/control/', { cache: 'no-store' })
      .then(async (res) => {
        // fetch resolves on HTTP errors too — a 503 mid-deploy must not
        // become the cached shell. Throw → install fails → prior
        // generation stays live.
        if (!res.ok) throw new Error(`control shell fetch failed: ${res.status}`);
        const html = await res.text();
        const hash = /assets\/index-([\w-]+)\.js/.exec(html)?.[1] ?? `${Date.now()}`;
        generation = PREFIX + hash;
        const cache = await caches.open(generation);
        await cache.put(
          '/control/',
          new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // The worker can be killed between install and activate, losing
        // `generation` — recover the live cache as the newest namespaced
        // one (install created it last) before sweeping the rest.
        const own = keys.filter((k) => k.startsWith(PREFIX));
        const live = generation ?? own[own.length - 1];
        if (!live) return;
        generation = live;
        return Promise.all(own.filter((k) => k !== live).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith('/control/') || url.pathname.startsWith('/control/v1')) return;

  const put = (res) => {
    if (res.ok) {
      const copy = res.clone();
      // waitUntil keeps the write alive past the response — without it the
      // worker can die mid-put and the offline shell never populates
      e.waitUntil(currentCache().then((c) => c.put(request, copy)));
    }
    return res;
  };

  if (url.pathname.startsWith('/control/assets/')) {
    e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then(put)));
    return;
  }

  e.respondWith(
    fetch(request)
      .then(put)
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
