// The installed-app side of the PWA: service worker updates, the app icon badge,
// launches from the OS (shortcuts, notifications, shares) and the install prompt.

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredInstall: InstallEvent | null = null;
const installSubs = new Set<() => void>();

export const standalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'prompt' (Chromium can show its dialog), 'ios' (Share → Adicionar à Tela de Início), or null */
export function installMode(): 'prompt' | 'ios' | null {
  if (standalone()) return null;
  if (deferredInstall) return 'prompt';
  return isIOS() ? 'ios' : null;
}
export function onInstallChange(fn: () => void) {
  installSubs.add(fn);
  return () => void installSubs.delete(fn);
}
export async function promptInstall() {
  const e = deferredInstall;
  if (!e) return false;
  deferredInstall = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installSubs.forEach((f) => f());
  return outcome === 'accepted';
}

/** The app icon shows how many orders wait (Badging API; installed apps only). */
export function setBadge(n: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined);
}

/** The board is on screen: the order notifications on this device have done their job. */
export function ordersSeen() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'ORDERS_SEEN' });
}

let waiting: ServiceWorker | null = null;
const updateSubs = new Set<() => void>();
export const updateReady = () => !!waiting;
export function onUpdate(fn: () => void) {
  updateSubs.add(fn);
  return () => void updateSubs.delete(fn);
}
let registration: ServiceWorkerRegistration | null = null;
/** Ask the server for a new version now (a reconnect after a deploy, the sign-in screen). */
export function checkForUpdate() {
  void registration?.update().catch(() => undefined);
}

let reloading = false;
export function applyUpdate() {
  // another window may have let it take over already: then there is nothing to wait for
  if (waiting?.state !== 'installed') return location.reload();
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Whether worker `w` precaches the hashed files this page was loaded with. */
function sameBuild(w: ServiceWorker) {
  const urls = [
    ...document.querySelectorAll('script[src^="/admin/assets/"], link[href^="/admin/assets/"]'),
  ].map((el) => el.getAttribute('src') ?? el.getAttribute('href'));
  return new Promise<boolean>((done) => {
    if (!urls.length) return done(false);
    const ch = new MessageChannel();
    // a worker from before this check never answers: treat it as a new version
    const t = setTimeout(() => done(false), 3000);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      done(e.data === true);
    };
    w.postMessage({ type: 'HAS', urls }, [ch.port2]);
  });
}

/** Shell routes these: `/admin/...` URLs from notifications, shortcuts and launches. */
const open = (url: string) => window.dispatchEvent(new CustomEvent('vendua:open', { detail: url }));

export function startPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as InstallEvent;
    installSubs.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installSubs.forEach((f) => f());
  });

  // a chunk from a version the server no longer has: load the new version once
  window.addEventListener('vite:preloadError', (e) => {
    const k = 'vendua-admin-reloaded';
    try {
      // a stamp, not a flag: one reload per minute stops a loop, but a later deploy still recovers
      if (Date.now() - Number(sessionStorage.getItem(k) ?? 0) < 60_000) return;
      sessionStorage.setItem(k, String(Date.now()));
    } catch {
      return;
    }
    e.preventDefault();
    location.reload();
  });

  // launch_handler focus-existing: the OS hands the open window its target URL
  const lq = (
    window as {
      launchQueue?: { setConsumer: (f: (p: { targetURL?: string }) => void) => void };
    }
  ).launchQueue;
  lq?.setConsumer((p) => {
    if (!p.targetURL) return;
    const u = new URL(p.targetURL);
    open(u.pathname + u.search);
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // a tapped notification asks the open window to show its order
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string };
    if (d?.type === 'open' && d.url) open(d.url);
  });
  sw.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  const track = (reg: ServiceWorkerRegistration) => {
    const found = (w: ServiceWorker | null) => {
      // the first install has no update to announce
      if (!w || !sw.controller) return;
      void sameBuild(w).then((same) => {
        if (w.state === 'redundant') return;
        // Pages load network-first, so a page opened after a deploy already runs the new
        // version while the worker still waits for the old one's windows to close: let it take
        // over quietly (no reload) instead of offering an "update" that changes nothing.
        if (same) return w.postMessage({ type: 'SKIP_WAITING' });
        waiting = w;
        updateSubs.forEach((f) => f());
      });
    };
    const watched = new WeakSet<ServiceWorker>();
    const watch = (w: ServiceWorker | null) => {
      if (!w || watched.has(w)) return;
      watched.add(w);
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') found(w);
      });
    };
    if (reg.waiting) found(reg.waiting);
    // one still installing when this page registered (its updatefound came before we listened)
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  };
  const register = () =>
    sw
      .register('/admin/sw.js', { scope: '/admin/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        track(reg);
        // installed apps stay open for days: look for a new version on return and hourly
        // (live.ts also asks whenever the stream comes back after Core went away)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        setInterval(checkForUpdate, 60 * 60_000);
      })
      .catch(() => undefined);
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
