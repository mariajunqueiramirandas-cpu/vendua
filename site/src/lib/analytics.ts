// Privacy-first page views (Core's /analytics/v1/collect, proxied by this site's own nginx): no
// cookie, nothing kept in the browser, no third party. Core counts a visitor per day from a hash
// it can't reverse (/privacidade/ says so). Automation, local dev and a browser asking not to be
// tracked send nothing.

let first = true;

/** Measuring this visit is fine: the counter and Google Analytics (gtag.ts) both ask. */
export function measured(): boolean {
  if (typeof navigator === 'undefined' || navigator.webdriver) return false;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (n.globalPrivacyControl || n.doNotTrack === '1') return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

export function trackPageview(): void {
  if (!measured()) return;
  let ref = '';
  // a client-side navigation keeps the landing page's referrer: only the landing counts it
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
    p: 'site',
    id: (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, ''),
    path: location.pathname,
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
    /* lossy by design */
  }
}
