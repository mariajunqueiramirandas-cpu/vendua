import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';

/**
 * agent/channels/discovery — TinyFish driver. Search API for prospect
 * queries (GET api.search.tinyfish.ai), Fetch API (POST api.fetch.tinyfish.ai)
 * for reading found pages: clean markdown + every link on the page, which is
 * where the contact channels live (wa.me/api.whatsapp.com send links, mailto:,
 * tel:, social profiles). The model reads the text; contactsFromLinks parses
 * the URLs deterministically. `mock` driver returns canned prospects so
 * discovery runs end-to-end with no credentials.
 */

export interface DiscoveryResult {
  results: { title: string; url: string; snippet?: string }[];
}

/** Contacts parsed out of a fetched page's links — deterministic, no model
 *  judgment involved. Phones come from wa.me/api.whatsapp.com deep links and
 *  tel: urls; emails from mailto:. */
export interface FoundContacts {
  phones: string[];
  whatsappLinks: string[];
  emails: string[];
  instagram: string[];
  facebook: string[];
  tiktok: string[];
}

export interface ReadPage {
  url: string;
  /** redirect target when the provider followed one */
  finalUrl?: string;
  title: string | null;
  description: string | null;
  /** page content as markdown, full text — the agent does the reading */
  text: string;
  /** internal links worth a follow-up read (contato, sobre, cardápio…) */
  nav: string[];
  foundContacts: FoundContacts;
}

export interface ReadPagesResult {
  pages: ReadPage[];
  errors: { url: string; error: string }[];
}

export interface DiscoveryProvider {
  search(query: string, purpose: string): Promise<DiscoveryResult>;
  readPages(urls: string[], purpose: string): Promise<ReadPagesResult>;
}

// ---------------------------------------------------------------------------
// Result annotation — pure URL-structure parsing. Nothing is dropped: the
// model keeps every result and every judgment call; the annotations just
// spare it work it can't do better than code (a wa.me URL literally contains
// the phone; an instagram.com/<user> URL literally contains the handle).
// ---------------------------------------------------------------------------

export type ResultKind =
  /** deep link that IS the contact (wa.me/99…, api.whatsapp.com/send?phone=) */
  | 'contact'
  /** social profile root — the handle is the contact; pages are login-walled */
  | 'profile'
  /** directory / ordering platform / bot-blocked registry — lead signal,
   *  weak contact source (reads rarely pay off) */
  | 'listing'
  /** own-domain page — the only kind worth a read_pages call */
  | 'site';

export interface AnnotatedResult {
  title: string;
  url: string;
  kind: ResultKind;
  /** contacts parsed straight out of the URL — zero extraction needed */
  phone?: string;
  instagram?: string;
  /** verified whatsapp deep link without the number exposed (wa.me/message/…) */
  whatsappLink?: string;
  /** email/phone spotted in the result's own snippet — free, no fetch */
  email?: string;
  snippet?: string;
}

const LISTING_HOSTS = new Set([
  'ifood.com.br',
  'tripadvisor.com.br',
  'tripadvisor.com',
  'guiamais.com.br',
  'apontador.com.br',
  'telelistas.net',
  'solutudo.com.br',
  'waze.com',
  'youtube.com',
  'tiktok.com',
  'kwai.com',
  'linkedin.com',
  // hosted ordering platforms — JS-shell pages that fetch renders empty; the
  // store URL is still lead evidence, just a weak contact source
  'anota.ai',
  'instadelivery.com.br',
  'goomer.app',
  'takeat.app',
  'ueniweb.com',
  '99app.com',
  // company registries — bot-blocked on fetch, so a read never pays off
  'cnpj.biz',
  'cnpj.info',
  'casadosdados.com',
]);
/** Link-in-bio hubs — where an instagram-first business parks its real
 *  channels. A hub page is the cheapest fetch to a wa.me link. The shortener
 *  tail is the same pattern: the provider follows the redirect, so surfacing
 *  `bit.ly/x` in nav is a fetch that lands on the real contact page. */
const LINK_HUB_HOSTS = new Set([
  'linktr.ee',
  'lnk.bio',
  'bio.link',
  'beacons.ai',
  'linklist.bio',
  'allmylinks.com',
  'msha.ke',
  'hoo.be',
  'carrd.co',
  'solo.to',
  'wa.link',
  'linkbio.co',
  'camps.bio',
  'flow.page',
]);
/** URL shorteners — one opaque segment, destination resolves on read. Kept
 *  out of LINK_HUB_HOSTS on purpose: on a hub page a shortener link is the
 *  OUTBOUND contact (linktr.ee/x → w.app/x), not platform chrome. */
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'w.app',
  'cutt.ly',
  'tinyurl.com',
  'rebrand.ly',
  'short.io',
]);
/** Social redirect wrappers — the real destination sits in the `u` param
 *  (l.instagram.com/?u=…, l.facebook.com/l.php?u=…). Unwrap before parsing
 *  or the bio's linktr.ee reads as an instagram link. */
const REDIRECT_HOSTS = new Set([
  'l.instagram.com',
  'lm.instagram.com',
  'l.facebook.com',
  'lm.facebook.com',
]);
const PROFILE_HOSTS = new Set(['instagram.com', 'facebook.com']);
// instagram paths that aren't profiles — posts, help, auth.
const PROFILE_STOP = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'help',
  'accounts',
  'developer',
  'stories',
  'popular',
  'legal',
  'web',
  'tv',
  'direct',
  'topics',
]);
// facebook paths that aren't business pages — shares, dialogs, platform dirs.
const FACEBOOK_STOP = new Set([
  'sharer',
  'share',
  'dialog',
  'plugins',
  'login',
  'help',
  'policies',
  'groups',
  'events',
  'watch',
  'marketplace',
  'gaming',
]);
// internal links that usually carry contact info — the follow-up reads worth
// spending a fetch on, ahead of catalog-ish links (a product page repeats
// the home's contact block at best).
const NAV_CONTACT =
  /contato|contact|sobre|about|quem-somos|atendimento|or[cç]amento|encomend|visite-nos|where|unidades/i;
const NAV_CATALOG = /cardapio|card[aá]pio|menu|produtos|products|pedido|order|delivery|loja|shop/i;

const digits = (s: string): string => s.replace(/\D/g, '');

/** Hostname normalized for comparison — lowercased, www stripped. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Params that never change page content — stripped from the key; every
 *  other param is content (e.g. api.whatsapp.com/send?phone=X is a different
 *  page per phone) and stays, sorted for canonical order. */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|si$|ref$|_ga|pk_)/i;

/** Canonical identity for "have we extracted this yet" — host + path +
 *  content params, no fragment/trailing slash. */
export function pageKey(url: string): string | null {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return (
      u.hostname.toLowerCase().replace(/^www\./, '') +
      u.pathname.replace(/\/+$/, '') +
      (params ? `?${params}` : '')
    );
  } catch {
    return null;
  }
}

/** Unwrap a social redirect-wrapper link (l.instagram.com/?u=…) to its
 *  real destination. Non-wrapper or unparseable input comes back as-is. */
export function unwrapLink(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!REDIRECT_HOSTS.has(host)) return raw;
    const inner = u.searchParams.get('u');
    return inner && /^https?:\/\//.test(inner) ? inner : raw;
  } catch {
    return raw;
  }
}

/** Pull whatever the URL itself encodes: phone out of wa.me/whatsapp deep
 *  links, handle out of profile roots. `whatsappLink` marks every verified
 *  click-to-chat url — including wa.me/message/ and wa.me/c/ variants — even
 *  when it doesn't expose the number. Returns null fields otherwise. */
export function contactFromUrl(u: URL): {
  phone?: string;
  whatsappLink?: string;
  instagram?: string;
} {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'wa.me' || host === 'whatsapp.com') {
    const out: { phone?: string; whatsappLink?: string } = {};
    // click-to-chat surfaces: /<digits>, /message/<code>, /c/<digits>, /p/<item>/<digits>.
    // /message/ codes are opaque alphanumeric — never a phone. /p/ puts the
    // number LAST (wa.me/p/<item>/<phone>), so the last all-digit segment is
    // the destination; a segment with letters is a code, not a number.
    const segs = u.pathname.split('/').filter(Boolean);
    const numSeg = /^\/(message)\//i.test(u.pathname)
      ? undefined
      : [...segs].reverse().find((s) => /^\d{10,15}$/.test(s));
    if (host === 'wa.me' && (numSeg || /^\/(?:message|c|p)\//i.test(u.pathname))) {
      out.whatsappLink = u.toString();
    }
    if (numSeg) out.phone = `+${numSeg}`;
    return out;
  }
  if (host === 'api.whatsapp.com') {
    const out: { phone?: string; whatsappLink?: string } = {};
    const p = u.searchParams.get('phone') ?? '';
    const d = /^\+?\d{10,15}$/.test(p.trim()) ? p.trim().replace(/^\+/, '') : '';
    if (d || /^\/message(?:\/|$)/i.test(u.pathname)) {
      out.whatsappLink = u.toString();
    }
    if (d) out.phone = `+${d}`;
    return out;
  }
  if (host === 'instagram.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 1 && !PROFILE_STOP.has(seg[0]!.toLowerCase())) {
      return { instagram: `@${seg[0]}` };
    }
  }
  return {};
}

function hostMatches(host: string, hosts: Set<string>): boolean {
  return hosts.has(host) || [...hosts].some((h) => host.endsWith(`.${h}`));
}

/** Classify one result and surface contacts encoded in the URL. */
export function annotateResult(r: {
  title: string;
  url: string;
  snippet?: string;
}): AnnotatedResult {
  const base: AnnotatedResult = {
    title: r.title,
    url: r.url,
    kind: 'site',
    ...(r.snippet ? { snippet: r.snippet.slice(0, 160) } : {}),
  };
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return base;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const contact = contactFromUrl(u);
  const out: AnnotatedResult = contact.phone
    ? { ...base, kind: 'contact', phone: contact.phone }
    : contact.whatsappLink
      ? { ...base, kind: 'contact', whatsappLink: contact.whatsappLink }
      : contact.instagram
        ? { ...base, kind: 'profile', instagram: contact.instagram }
        : PROFILE_HOSTS.has(host)
          ? { ...base, kind: 'profile' }
          : hostMatches(host, LISTING_HOSTS) || host.endsWith('.gov.br') || host.endsWith('.gov')
            ? { ...base, kind: 'listing' }
            : base;
  // Snippet text sometimes carries the contact itself (google business blurb,
  // bio teaser) — parse it for free before spending a fetch; each field fills
  // independently so a URL phone doesn't hide a snippet email.
  if (r.snippet && (!out.phone || !out.email)) {
    const c = contactsFromText(r.snippet);
    if (!out.phone && c.phones[0]) out.phone = c.phones[0];
    if (!out.email && c.emails[0]) out.email = c.emails[0];
    if ((c.phones[0] || c.emails[0]) && out.kind === 'site') out.kind = 'contact';
  }
  return out;
}

/** Annotate + dedupe by page identity + order contact > site > profile >
 *  listing, capped at 12 — every result is still returned, just shaped so
 *  the model spends calls on pages that can pay off. */
export function annotateResults(results: { title: string; url: string; snippet?: string }[]): {
  results: AnnotatedResult[];
  droppedDupes: number;
} {
  const seen = new Set<string>();
  const out: AnnotatedResult[] = [];
  let droppedDupes = 0;
  for (const r of results) {
    const key = pageKey(r.url) ?? r.url;
    if (seen.has(key)) {
      droppedDupes++;
      continue;
    }
    seen.add(key);
    out.push(annotateResult(r));
  }
  const rank: Record<ResultKind, number> = { contact: 0, site: 1, profile: 2, listing: 3 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return { results: out.slice(0, 12), droppedDupes };
}

const uniqPush = (arr: string[], v: string) => {
  if (!arr.includes(v)) arr.push(v);
};

/** Every contact channel a page's links encode — whatsapp/wa.me send links
 *  carry the phone, social roots carry the handle, mailto:/tel: are direct.
 *  This is why read_pages returns links:true: for this prospect segment the
 *  contact block is a row of icon links, not body text. */
export function contactsFromLinks(links: string[]): FoundContacts {
  const out: FoundContacts = {
    phones: [],
    whatsappLinks: [],
    emails: [],
    instagram: [],
    facebook: [],
    tiktok: [],
  };
  for (const link of links) {
    const raw = unwrapLink(link);
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.protocol === 'mailto:') {
      // Provider-returned links are external page data — a malformed percent
      // escape must cost this link, not the whole batch.
      let email: string;
      try {
        email = decodeURIComponent(u.pathname).trim();
      } catch {
        continue;
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) uniqPush(out.emails, email);
      continue;
    }
    if (u.protocol === 'tel:') {
      const d = digits(u.pathname);
      if (d.length < 8) continue;
      // `tel:` only carries an international number when it starts with '+'.
      // BR pages publish DDD+number (10-11 digits) without it — prefixing
      // '+' there fabricates a wrong country code, so normalize local forms
      // to +55 and keep short fragments as a bare-digit hint.
      const phone = u.pathname.trim().startsWith('+')
        ? `+${d}`
        : d.length >= 10 && d.length <= 11
          ? `+55${d}`
          : d;
      uniqPush(out.phones, phone);
      continue;
    }
    const wa = contactFromUrl(u);
    if (wa.whatsappLink) uniqPush(out.whatsappLinks, wa.whatsappLink);
    if (wa.phone) {
      uniqPush(out.phones, wa.phone);
      continue;
    }
    if (wa.instagram) uniqPush(out.instagram, wa.instagram);
    if (host === 'facebook.com') {
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg.length === 1 && !FACEBOOK_STOP.has(seg[0]!.toLowerCase())) {
        uniqPush(out.facebook, `facebook.com/${seg[0]}`);
      }
    }
    if (host === 'tiktok.com') {
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg.length === 1 && seg[0]!.startsWith('@')) {
        uniqPush(out.tiktok, seg[0]!);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text extraction — the contact surface that isn't an anchor. Brazilian
// small-business pages (and instagram bios above all) print the whatsapp as
// text: "wa.me/5522…", "(22) 9 9712-3470", "pedidos: contato@doceria.com".
// ---------------------------------------------------------------------------

/** A url written out in prose — scheme optional for the contact domains,
 *  required otherwise. */
const TEXT_URL_RE = /https?:\/\/[^\s"'<>()[\]]+/gi;
const BARE_CONTACT_RE =
  /\b(?:[\w-]+\.)?(?:wa\.me|api\.whatsapp\.com|linktr\.ee|lnk\.bio|bio\.link|beacons\.ai|linklist\.bio|allmylinks\.com|msha\.ke|hoo\.be|carrd\.co|solo\.to|wa\.link|linkbio\.co|camps\.bio|flow\.page|bit\.ly|w\.app|cutt\.ly|tinyurl\.com|rebrand\.ly|short\.io)\/[^\s"'<>()[\]]*/gi;
const EMAIL_TEXT_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ASSET_TAIL_RE = /\.(?:png|jpe?g|gif|webp|svg|css|js|mjs|ico|woff2?|ttf|otf)$/i;
/** BR phones, formatted: optional +55, DDD (parens optional), 8-9 digit
 *  subscriber with a separator before the last 4 — the separator requirement
 *  and the \w-ish boundaries keep CNPJs/dates/prices out. Bare contiguous
 *  numbers only count when they're the 11-13 digit mobile shape (55? + DDD +
 *  9xxxxxxxx) — a bare landline can't be told apart from any 10-digit code. */
const PHONE_TEXT_RE =
  /(?<![\w@/.-])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]\d{4}(?![\w/-])|\b\+?(?:55)?\d{2}9\d{8}\b/g;

/** Normalize a phone-shaped match to +55…/intl, or null when it's not a
 *  callable-looking number (too short, weird country-less form). */
export function phoneFromText(raw: string): string | null {
  const d = digits(raw);
  // An explicit + means the country code is already there — keep it verbatim
  // (8–15 digits = E.164 range) instead of gluing +55 onto a foreign number.
  if (/^\s*\(?\+/.test(raw)) {
    return d.length >= 8 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null;
  }
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return null;
}

function isHubHost(host: string): boolean {
  // subdomain-aware: carrd.co sites are <name>.carrd.co — an exact-match set
  // would drop every one of them out of the hub path.
  return hostMatches(host, LINK_HUB_HOSTS);
}

/** Profile-shaped url on a link-in-bio host — the business's own hub page,
 *  not platform chrome. Apex hubs put the handle in the path (linktr.ee/x);
 *  subdomain hubs put it in the host (x.carrd.co, path `/` or a section). */
function isProfileHubUrl(u: URL): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean).length;
  if (LINK_HUB_HOSTS.has(h) || SHORTENER_HOSTS.has(h)) return segs === 1;
  return hostMatches(h, LINK_HUB_HOSTS) && segs <= 1;
}

/** Contacts printed in body text — same fields as contactsFromLinks, so the
 *  caller merges the two lists per field. Also returns link-in-bio hub urls
 *  spotted in prose (instagram renders the bio link as text, not an anchor). */
export function contactsFromText(text: string): FoundContacts & { hubs: string[] } {
  const out: FoundContacts & { hubs: string[] } = {
    phones: [],
    whatsappLinks: [],
    emails: [],
    instagram: [],
    facebook: [],
    tiktok: [],
    hubs: [],
  };
  const seen = new Set<string>();
  const urlish = [...text.matchAll(TEXT_URL_RE), ...text.matchAll(BARE_CONTACT_RE)];
  for (const m of urlish) {
    let raw = m[0].replace(/[.,;!?]+$/, '');
    if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`;
    raw = unwrapLink(raw);
    if (seen.has(raw)) continue;
    seen.add(raw);
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const wa = contactFromUrl(u);
    if (wa.whatsappLink) uniqPush(out.whatsappLinks, wa.whatsappLink);
    if (wa.phone) uniqPush(out.phones, wa.phone);
    if (wa.instagram) uniqPush(out.instagram, wa.instagram);
    if (isProfileHubUrl(u)) {
      uniqPush(out.hubs, `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`);
    }
  }
  for (const m of text.matchAll(EMAIL_TEXT_RE)) {
    const email = m[0].toLowerCase();
    if (ASSET_TAIL_RE.test(email) || /@\d+x\./.test(email)) continue;
    uniqPush(out.emails, email);
    if (out.emails.length >= 4) break;
  }
  for (const m of text.matchAll(PHONE_TEXT_RE)) {
    const phone = phoneFromText(m[0]);
    if (phone) uniqPush(out.phones, phone);
    if (out.phones.length >= 6) break;
  }
  return out;
}

/** The links most likely to carry contact info or the catalog — surfaced so
 *  the model can queue a follow-up read without re-fetching junk (blog posts,
 *  product detail pages, anchors). Same-host contact-ish paths plus
 *  cross-host link-in-bio hubs (unwrapped from social redirects), capped. */
export function navLinks(links: string[], pageUrl: string): string[] {
  const host = hostOf(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  // hubs first — for ig-first businesses the link-in-bio IS the contact
  // page. A hub's OWN pages are footer noise (staff picks, /s/about), so hub
  // surfacing only happens from non-hub pages and only for profile-shaped
  // (single-segment) urls.
  if (!host || !isHubHost(host)) {
    for (const link of links) {
      const raw = unwrapLink(link);
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      if (isProfileHubUrl(u)) {
        push(`${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`);
      }
    }
  }
  if (!host) return out.slice(0, 8);
  if (isHubHost(host)) {
    // On a hub page the same-host links are the platform's own chrome — the
    // follow-ups worth anything point OUT to the business's own domain.
    for (const link of links) {
      const raw = unwrapLink(link);
      const h = hostOf(raw);
      if (!h || h === host) continue;
      if (isHubHost(h) || PROFILE_HOSTS.has(h) || hostMatches(h, LISTING_HOSTS)) continue;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      const c = contactFromUrl(u);
      // wa.me/api.whatsapp destinations are already in foundContacts — nav
      // exists to point at pages worth another fetch.
      if (c.phone || c.whatsappLink) continue;
      push(`${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || '/'}`);
      if (out.length >= 8) break;
    }
    return out.slice(0, 8);
  }
  // two passes: contact-ish paths first, catalog-ish backfill to the cap —
  // otherwise a site whose nav is mostly product cards never surfaces /contato.
  for (const hint of [NAV_CONTACT, NAV_CATALOG]) {
    for (const link of links) {
      const raw = unwrapLink(link);
      const h = hostOf(raw);
      if (h !== host) continue;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      const path = u.pathname.replace(/\/+$/, '') || '/';
      if (!hint.test(path)) continue;
      push(`${u.protocol}//${u.host}${path}`);
    }
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}

/** Base URLs are configurable per-integration but pinned to TinyFish hosts
 *  over https — otherwise the config row becomes an SSRF primitive that
 *  exfiltrates the API key to an arbitrary endpoint. */
function tinyfishBase(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' && raw ? raw : fallback;
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    !(u.hostname === 'tinyfish.ai' || u.hostname.endsWith('.tinyfish.ai'))
  ) {
    throw new Error(`tinyfish driver: url must be https under *.tinyfish.ai (got ${value})`);
  }
  return value.replace(/\/+$/, '');
}

/** inet_aton semantics — 1–4 parts, each decimal/octal/hex; the last part
 *  carries however many bytes are left. Returns the address as u32, or
 *  null when the host isn't an IPv4 literal at all. Catches every notation
 *  an agent could smuggle past string-prefix checks (0177.0.0.1, 0x7f…1,
 *  2130706433). */
function ipv4ToU32(host: string): number | null {
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums = parts.map((p) =>
    /^0x[0-9a-f]+$/i.test(p)
      ? parseInt(p, 16)
      : /^0[0-7]+$/.test(p)
        ? parseInt(p, 8)
        : /^[0-9]+$/.test(p)
          ? parseInt(p, 10)
          : NaN,
  );
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const last = nums[nums.length - 1]!;
  const lastBytes = 5 - nums.length; // bytes the last part must hold
  if (nums.slice(0, -1).some((n) => n > 255) || last >= 256 ** lastBytes) return null;
  let ip = 0;
  for (const n of nums.slice(0, -1)) ip = ip * 256 + n;
  return ip * 256 ** lastBytes + last;
}

/** Private/reserved IPv4 ranges — the targets a fetched URL must never
 *  name. */
function isPrivateV4(ip: number): boolean {
  const top = (bits: number) => ip >>> (32 - bits);
  return (
    top(8) === 0 || // 0.0.0.0/8 "this host"
    top(8) === 10 ||
    top(8) === 127 ||
    top(12) === 0xac1 || // 172.16/12
    top(16) === 0xa9fe || // 169.254/16 link-local (incl. 169.254.169.254)
    top(16) === 0xc0a8 || // 192.168/16
    top(10) === 0x19 || // 100.64/10 CGNAT
    top(15) === 0x6122 || // 198.18/15 benchmarking
    top(4) >= 0xe // 224/4 multicast + 240/4 reserved
  );
}

/** The provider fetches the page, not us — but an agent-controlled URL
 *  should still never name an internal or loopback host. */
function assertFetchable(url: string): URL {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`unsupported url scheme ${target.protocol}`);
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  let privateHost =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost');
  if (!privateHost && host.includes(':')) {
    // IPv6 literal: ::/::1 (unspecified/loopback), fc00::/7 unique-local,
    // fe80::/10 link-local, and any ::ffff:-mapped or dotted-quad tail whose
    // v4 part is private.
    const head = parseInt(host.split(':')[0] || '0', 16);
    const v4Tail = /([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$/.exec(host)?.[1];
    privateHost =
      host === '::' ||
      host === '::1' ||
      host.startsWith('::ffff:') ||
      (head & 0xfe00) === 0xfc00 ||
      (head & 0xffc0) === 0xfe80 ||
      (v4Tail !== undefined && isPrivateV4(ipv4ToU32(v4Tail) ?? 0));
  }
  if (!privateHost) {
    const ip = ipv4ToU32(host);
    if (ip !== null) privateHost = isPrivateV4(ip);
  }
  if (privateHost) {
    throw new Error(`private/internal target not allowed: ${host}`);
  }
  return target;
}

function tinyfish(integration: IntegrationRow): DiscoveryProvider {
  const secretRef = integration.secret_ref;
  const apiKey = (secretRef && process.env[secretRef]) ?? process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error(`tinyfish driver: missing ${secretRef ?? 'TINYFISH_API_KEY'}`);
  const searchBase = tinyfishBase(integration.config.searchUrl, 'https://api.search.tinyfish.ai');
  const fetchBase = tinyfishBase(integration.config.fetchUrl, 'https://api.fetch.tinyfish.ai');
  return {
    async search(query, purpose) {
      const u = new URL(searchBase);
      u.searchParams.set('query', query);
      u.searchParams.set('purpose', purpose);
      u.searchParams.set('language', 'pt-BR');
      u.searchParams.set('location', 'BR');
      const res = await fetch(u, { headers: { 'x-api-key': apiKey } });
      if (!res.ok)
        throw new Error(`tinyfish search ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        results?: { title?: string; url?: string; description?: string }[];
      };
      return {
        results: (data.results ?? []).map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          ...(r.description ? { snippet: r.description } : {}),
        })),
      };
    },
    async readPages(urls, purpose) {
      // Fetch API batches up to 10 urls per POST; per-URL failures land in
      // errors[] without sinking the batch — mirrors how the tool treats a
      // batch of reads.
      const errors: { url: string; error: string }[] = [];
      const good: string[] = [];
      for (const url of urls.slice(0, 10)) {
        try {
          assertFetchable(url);
          good.push(url);
        } catch (e) {
          errors.push({ url, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!good.length) return { pages: [], errors };
      const res = await fetch(fetchBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          urls: good,
          format: 'markdown',
          // links are the contact surface — wa.me/mailto:/tel:/socials live
          // there even when body text doesn't render them.
          links: true,
          ...(purpose.trim() ? { purpose: purpose.slice(0, 2000) } : {}),
          per_url_timeout_ms: 45_000,
        }),
      });
      if (!res.ok)
        throw new Error(`tinyfish fetch ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        results?: {
          url?: string;
          final_url?: string;
          title?: string | null;
          description?: string | null;
          text?: string | null;
          links?: string[];
        }[];
        errors?: { url?: string; error?: string }[];
      };
      const pages: ReadPage[] = [];
      for (const r of data.results ?? []) {
        const links = Array.isArray(r.links) ? r.links : [];
        const url = r.url ?? '';
        const text = typeof r.text === 'string' ? r.text : '';
        // Links carry the rendered anchors; text carries what the business
        // printed (the instagram bio's wa.me is text, not a link). Union both.
        const fromLinks = contactsFromLinks(links);
        const fromText = contactsFromText(text);
        const foundContacts: FoundContacts = {
          phones: [...new Set([...fromLinks.phones, ...fromText.phones])],
          whatsappLinks: [...new Set([...fromLinks.whatsappLinks, ...fromText.whatsappLinks])],
          emails: [...new Set([...fromLinks.emails, ...fromText.emails])],
          instagram: [...new Set([...fromLinks.instagram, ...fromText.instagram])],
          facebook: [...new Set([...fromLinks.facebook, ...fromText.facebook])],
          tiktok: [...new Set([...fromLinks.tiktok, ...fromText.tiktok])],
        };
        pages.push({
          url,
          ...(r.final_url && r.final_url !== url ? { finalUrl: r.final_url } : {}),
          title: r.title ?? null,
          description: r.description ?? null,
          text,
          // links belong to the rendered destination — on a redirect the
          // same-host nav check must compare against final_url, not the
          // requested url, or every internal follow-up drops out.
          nav: [...new Set([...navLinks(links, r.final_url ?? url), ...fromText.hubs])].slice(0, 8),
          foundContacts,
        });
      }
      for (const e of data.errors ?? []) {
        if (e.url) errors.push({ url: e.url, error: e.error ?? 'fetch failed' });
      }
      return { pages, errors };
    },
  };
}

function mock(): DiscoveryProvider {
  return {
    async search() {
      return {
        results: [
          {
            title: 'Doceria Aurora — Instagram',
            url: 'https://instagram.com/doceria.aurora',
            snippet: 'Bolos sob encomenda, Fortaleza',
          },
          {
            title: 'Ateliê Doce Lar',
            url: 'https://ateliedocelar.example.br',
            snippet: 'Brigaderia artesanal, Meireles',
          },
        ],
      };
    },
    async readPages(urls) {
      const empty: FoundContacts = {
        phones: [],
        whatsappLinks: [],
        emails: [],
        instagram: [],
        facebook: [],
        tiktok: [],
      };
      return {
        pages: urls.map((url) => ({
          url,
          title: 'Ateliê Doce Lar',
          description: 'Brigaderia artesanal sob encomenda, Fortaleza',
          text: '# Ateliê Doce Lar\n\nBrigaderia artesanal sob encomenda. Peça pelo WhatsApp ou Instagram. Entregas no Meireles e região.',
          nav: [`${url.replace(/\/+$/, '')}/contato`],
          foundContacts: {
            ...empty,
            phones: ['+5585999990001'],
            whatsappLinks: ['https://wa.me/5585999990001'],
            instagram: ['@doceria.aurora'],
          },
        })),
        errors: [],
      };
    },
  };
}

export async function discoveryFor(sql: Sql): Promise<DiscoveryProvider> {
  const integration = await getIntegration(sql, 'discovery');
  if (!integration || !integration.enabled) return mock();
  if (integration.driver === 'tinyfish') return tinyfish(integration);
  return mock();
}
