// Venduá merchant admin service worker. The build (vite.config.ts `serviceWorker`)
// prepends VERSION and PRECACHE: every file the app can load, so any screen opens
// offline and a deploy rolls out as one atomic version (the page asks before
// switching). Also: web push for new orders with "aceitar" from the notification, for a
// shopper waiting in a Vendedor conversation with "assumir", the app icon badge, and the
// share target (a photo shared from the gallery).
/* global VERSION, PRECACHE */
const SHELL = `vendua-admin-${VERSION}`;
const MEDIA = 'vendua-admin-media';
const SHARE = 'vendua-admin-share';
const MEDIA_MAX = 300;
const INDEX = '/admin/index.html';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      // bypass the HTTP cache: a stale copy would be pinned for the whole version
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(async () => {
        // first install: nothing to disrupt, take over now
        if (!self.registration.active) await self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('vendua-admin-') && ![SHELL, MEDIA, SHARE].includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') void self.skipWaiting();
  if (d.type === 'HAS' && e.ports[0])
    e.waitUntil(has(d.urls).then((r) => e.ports[0].postMessage(r)));
  if (d.type === 'ORDERS_SEEN') e.waitUntil(clearOrderAlerts());
});

const ours = (urls) =>
  Array.isArray(urls) && urls.length > 0 && urls.every((u) => PRECACHE.includes(u));

// The page asks before announcing this worker: does it already run this version (its hashed
// files are all ours), and is this version what the server serves now? A CDN can hand out a
// stale sw.js hours after a deploy, which would read as a "new" version. index.html is
// no-store, and a worker's own fetch skips every fetch handler.
async function has(urls) {
  const html = await fetch(INDEX, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  const served = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^"]+)"/g)].map((m) => m[1]);
  // offline or an error page: unknown, so don't hold a real update back
  return { page: ours(urls), current: served.length === 0 || ours(served) };
}

async function clearOrderAlerts() {
  const list = await self.registration.getNotifications();
  list.filter((n) => (n.tag || '').startsWith('order-')).forEach((n) => n.close());
}

async function fromShell(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) void c.put(req, res.clone());
  return res;
}

// photos: show the cached one at once, refresh it behind the scenes
async function media(e) {
  const c = await caches.open(MEDIA);
  const hit = await c.match(e.request);
  const net = fetch(e.request)
    .then(async (res) => {
      if (res.ok) {
        await c.put(e.request, res.clone());
        const keys = await c.keys();
        await Promise.all(
          keys.slice(0, Math.max(0, keys.length - MEDIA_MAX)).map((k) => c.delete(k)),
        );
      }
      return res;
    })
    .catch(() => hit || Response.error());
  if (hit) {
    e.waitUntil(net);
    return hit;
  }
  return net;
}

// Web Share Target (manifest share_target): keep the photo, open "novo produto" with it
async function receiveShare(e) {
  const form = await e.request.formData().catch(() => null);
  const file =
    form && form.getAll('photos').find((f) => f && f.type && f.type.startsWith('image/'));
  if (!file) return Response.redirect('/admin/cardapio', 303);
  const c = await caches.open(SHARE);
  await c.put(
    '/admin/__share/photo',
    new Response(file, {
      headers: { 'content-type': file.type, 'x-name': encodeURIComponent(file.name || 'foto') },
    }),
  );
  return Response.redirect('/admin/cardapio?foto=compartilhada', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname === '/admin/compartilhar') {
    e.respondWith(receiveShare(e));
    return;
  }
  if (e.request.method !== 'GET') return;
  // the API is live data; the app keeps its own last-known copy (IndexedDB)
  if (url.pathname.startsWith('/admin/v1/') || url.pathname === '/admin/sw.js') return;
  if (url.pathname.startsWith('/v1/media/')) {
    e.respondWith(media(e));
    return;
  }
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/admin')) {
    // Network first: a cache-first shell pinned a broken version on the phone (a blank screen the
    // page could never ask to update). The cached shell is the offline / slow-network fallback.
    e.respondWith(
      Promise.race([fetch(e.request), new Promise((_, no) => setTimeout(no, 4000))]).catch(() =>
        caches
          .open(SHELL)
          .then((c) => c.match(INDEX))
          .then((hit) => hit || fetch(e.request)),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/admin/')) e.respondWith(fromShell(e.request));
});

async function setBadge() {
  if (!self.navigator.setAppBadge) return;
  const n = (await self.registration.getNotifications()).filter(
    (x) => (x.tag || '').startsWith('order-') || (x.tag || '').startsWith('vendedor-'),
  ).length;
  await (n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
}

self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Venduá', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Pedido novo';
  e.waitUntil(
    self.registration
      .showNotification(title, {
        body: data.body || '',
        tag: data.tag,
        renotify: true,
        requireInteraction: true,
        timestamp: Date.now(),
        icon: '/admin/icons/icon-192.png',
        // Android draws the badge as a white silhouette in the status bar
        badge: '/admin/icons/badge-96.png',
        vibrate: [180, 90, 180],
        data: { url: data.url || '/admin/pedidos', orderId: data.orderId, threadId: data.threadId },
        actions: data.threadId
          ? takeActions(data.actions)
          : data.orderId
            ? [{ action: 'accept', title: 'Aceitar' }]
            : [],
      })
      .then(setBadge),
  );
});

// a waiting shopper: "assumir" takes the conversation from the lock screen, "abrir" opens it as is
function takeActions(sent) {
  const list = Array.isArray(sent) && sent.length ? sent : [{ action: 'take', title: 'assumir' }];
  return list.some((a) => a.action === 'open')
    ? list
    : [...list, { action: 'open', title: 'abrir' }];
}

self.addEventListener('notificationclose', (e) => e.waitUntil(setBadge()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, orderId, threadId } = e.notification.data || {};
  const open = async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).pathname.startsWith('/admin'));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url || '/admin/pedidos');
  };
  if (e.action === 'take' && threadId) {
    e.waitUntil(
      fetch(`/admin/v1/vendedor/threads/${encodeURIComponent(threadId)}/take`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-vendua-admin': '1',
          'idempotency-key': `push-take-${threadId}`,
        },
        body: '{}',
      })
        .catch(() => undefined)
        // taken or not, the conversation is where the reply happens
        .then(open)
        .then(setBadge),
    );
    return;
  }
  if (e.action === 'accept' && orderId) {
    e.waitUntil(
      fetch(`/admin/v1/orders/${orderId}/transition`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-vendua-admin': '1',
          'idempotency-key': `push-accept-${orderId}`,
        },
        body: JSON.stringify({ to: 'confirmed' }),
      })
        .then((res) =>
          res.ok
            ? self.registration.showNotification('Pedido aceito', {
                body: 'Já está em "aceitos". Bom trabalho!',
                tag: `accepted-${orderId}`,
                icon: '/admin/icons/icon-192.png',
                badge: '/admin/icons/badge-96.png',
              })
            : open(),
        )
        .catch(open)
        .then(setBadge),
    );
    return;
  }
  e.waitUntil(open().then(setBadge));
});
