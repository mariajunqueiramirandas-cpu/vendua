// Privacy-first page views (Core's /analytics/v1/collect, first-party through the admin's own
// nginx): no cookie, nothing kept in the browser, no third party, no ids in the path. Core counts
// a visitor per day from a hash it can't reverse; it never sees who is signed in.

let last = '';
let first = true;

/** The route, not the address: order ids, product ids and customer phones become `:id`. */
export function routeShape(pathname: string): string {
  return pathname
    .split('/')
    .map((s) => (/\d{4,}|@|^[0-9a-f-]{20,}$/i.test(decodeURIComponentSafe(s)) ? ':id' : s))
    .join('/');
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '0000';
  }
}

export function trackPageview(pathname: string): void {
  const path = `/admin${routeShape(pathname)}`;
  // StrictMode and replace-navigations re-run the effect for the same screen
  if (path === last || typeof navigator === 'undefined' || navigator.webdriver) return;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (n.globalPrivacyControl || n.doNotTrack === '1') return;
  last = path;
  let ref = '';
  if (first && document.referrer) {
    try {
      ref = new URL(document.referrer).host;
    } catch {
      /* not a URL */
    }
  }
  const q = new URLSearchParams(first ? location.search : '');
  first = false;
  const body = JSON.stringify({
    p: 'admin',
    id: (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, ''),
    path,
    ref,
    w: window.innerWidth,
    utm: {
      source: q.get('utm_source') ?? undefined,
      medium: q.get('utm_medium') ?? undefined,
      campaign: q.get('utm_campaign') ?? undefined,
    },
  });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.('/analytics/v1/collect', blob)) return;
    void fetch('/analytics/v1/collect', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    /* lossy by design: analytics never gets in the way */
  }
}
