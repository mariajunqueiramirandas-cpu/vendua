/* /control/assets/* (content-hashed) is cache-first; the rest of /control/
   is network-first with cache as offline fallback — /control/v1 is never
   intercepted. One cache per deploy, named after the bundle hash in
   index.html; cleanup on activate stays inside the vendua-control-*
   namespace. */
const PREFIX = 'vendua-control-';
let generation; // set by install; undefined if the worker restarted before activate

const currentCache = () =>
  caches.keys().then((keys) => {
    // pick the newest namespaced cache (insertion order) so writes never
    // go to the stale one about to be deleted
    const own = keys.filter((k) => k.startsWith(PREFIX));
    return caches.open(generation ?? own[own.length - 1] ?? PREFIX + 'boot');
  });

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('/control/', { cache: 'no-store' })
      .then(async (res) => {
        // throw on HTTP error so a mid-deploy 503 can't become the cached
        // shell — install fails, prior generation stays live
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
        // the worker may be killed between install and activate — recover
        // the newest namespaced cache before sweeping the rest
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
      // waitUntil keeps the write alive past the response
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
