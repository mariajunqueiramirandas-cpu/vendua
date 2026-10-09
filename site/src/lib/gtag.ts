// Google Analytics (gtag.js), for Google Ads: on only when the build sets PUBLIC_GA_ID (G-…) and/or
// PUBLIC_GOOGLE_ADS_ID (AW-…), and only for a visit the first-party counter would count too
// (analytics.ts). /privacidade/ tells which build this is through `googleTag`. Page views after the
// first are GA4's own (enhanced measurement follows the client-side navigations).
import { measured } from './analytics';

const ids = [import.meta.env.PUBLIC_GA_ID, import.meta.env.PUBLIC_GOOGLE_ADS_ID].filter(
  (id): id is string => typeof id === 'string' && /^(G|AW)-[A-Z0-9]+$/.test(id),
);

export const googleTag = ids.length > 0;

type Gtag = (...args: unknown[]) => void;
let gtag: Gtag | null = null;

export function startGoogleTag(): void {
  if (gtag || !googleTag || !measured()) return;
  const w = window as Window & { dataLayer?: unknown[] };
  w.dataLayer ??= [];
  // gtag.js reads the arguments objects themselves, not arrays
  gtag = function () {
    w.dataLayer!.push(arguments);
  };
  gtag('js', new Date());
  for (const id of ids) gtag('config', id);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ids[0]}`;
  document.head.append(s);
}

/** GA4's `sign_up`, then `done` once it's sent (or after a short wait: a blocker drops gtag.js). */
export function sendSignUp(done: () => void): void {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    done();
  };
  startGoogleTag();
  if (!gtag) return once();
  setTimeout(once, 2500);
  gtag('event', 'sign_up', { method: 'painel', event_callback: once, event_timeout: 2000 });
}
