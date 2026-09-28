// Venduá merchant admin service worker: the app shell offline, web push for new
// orders, and "aceitar" straight from the notification (1 tap, design spec §2.1).
const SHELL = 'vendua-admin-shell-v1';
const ASSETS = 'vendua-admin-assets-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/admin/', '/admin/manifest.webmanifest', '/admin/icons/icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // the API is live data — the app keeps its own last-known copy
  if (url.pathname.startsWith('/admin/v1/')) return;
  if (url.pathname.startsWith('/admin/assets/')) {
    // content-hashed: cache first, forever
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/admin')) {
    // network first so a deploy rolls out; the cached shell opens the app offline
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put('/admin/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/admin/')),
    );
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Venduá', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Pedido novo';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      icon: '/admin/icons/icon-192.png',
      badge: '/admin/icons/icon-192.png',
      vibrate: [180, 90, 180],
      data: { url: data.url || '/admin/pedidos', orderId: data.orderId },
      actions: data.orderId ? [{ action: 'accept', title: 'Aceitar' }] : [],
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, orderId } = e.notification.data || {};
  const open = async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.includes('/admin'));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url || '/admin/pedidos');
  };
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
                tag: `order-${orderId}`,
                icon: '/admin/icons/icon-192.png',
              })
            : open(),
        )
        .catch(open),
    );
    return;
  }
  e.waitUntil(open());
});
