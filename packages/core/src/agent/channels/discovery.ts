import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';

// TinyFish discovery driver — Search + Fetch (markdown + every link on the
// page, which is where contact channels live); `mock` needs no credentials.

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
  /** undialable phone-shaped fragments (bare 9xxxx-xxxx, no DDD) — proof a
   *  whatsapp exists; a follow-up resolves the full number. */
  phoneHints: string[];
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
  /** provider cut the render short (instagram's '…mais' tail etc.) — the
   *  contact line can sit past the fold; resolve via search/directories. */
  truncated?: boolean;
  /** url of the page whose nav surfaced this one — set on auto-chased reads */
  chasedFrom?: string;
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

// result annotation is pure URL-structure parsing — it spares the model work
// code does better (a wa.me URL contains the phone; instagram.com/<user> the handle)

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
/** link-in-bio hubs — where an ig-first business parks its real channels;
 *  the cheapest fetch to a wa.me link */
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
/** URL shorteners — opaque tail, destination resolves on read. Kept out of
 *  LINK_HUB_HOSTS: on a hub page a shortener link is the OUTBOUND contact. */
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'w.app',
  'cutt.ly',
  'tinyurl.com',
  'rebrand.ly',
  'short.io',
]);
/** social redirect wrappers — real destination sits in the `u` param;
 *  unwrap before parsing or a linktr.ee reads as an instagram link */
const REDIRECT_HOSTS = new Set([
  'l.instagram.com',
  'lm.instagram.com',
  'l.facebook.com',
  'lm.facebook.com',
]);
const PROFILE_HOSTS = new Set(['instagram.com', 'facebook.com']);

/** g.co/kgs + maps urls — the business's profile page (phone, address, hours),
 *  the cheapest reliable phone source when a hub hides wa.me behind JS */
function isBizMapUrl(u: URL): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  const p = u.pathname;
  return (
    (h === 'g.co' && /^\/kgs\//i.test(p)) ||
    h === 'maps.app.goo.gl' ||
    /^maps\.google\.[a-z.]+$/.test(h) ||
    (/^google\.[a-z.]+$/.test(h) && /^\/maps/i.test(p))
  );
}

/** google.tld under any web subdomain — the family a pointer's redirect or
 *  name carrier can live on */
const GOOGLE_HOST = /^((www|maps|m)\.)?google\.[a-z]{2,}(\.[a-z]{2})?$/i;
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
// contact-ish paths rank ahead of catalog-ish — a product page repeats the
// home's contact block at best
const NAV_CONTACT =
  /contato|contact|sobre|about|quem-somos|atendimento|or[cç]amento|encomend|visite-nos|where|unidades/i;
const NAV_CATALOG = /cardapio|card[aá]pio|menu|produtos|products|pedido|order|delivery|loja|shop/i;

const digits = (s: string): string => s.replace(/\D/g, '');

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** tracking params are stripped from the key; every other param is content
 *  (send?phone=X is a different page per phone) and stays, sorted */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igsh(id)?$|hl$|si$|ref$|_ga|pk_)/i;

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

/** contacts encoded in the URL itself — phone from deep links, handle from
 *  profile roots; `whatsappLink` marks verified click-to-chat urls even when
 *  they don't expose the number */
export function contactFromUrl(u: URL): {
  phone?: string;
  whatsappLink?: string;
  instagram?: string;
} {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'wa.me' || host === 'whatsapp.com') {
    const out: { phone?: string; whatsappLink?: string } = {};
    // the number is the last all-digit segment (/p/ puts it last); segments
    // with letters are opaque codes (/message/, /qr/), never a phone
    const segs = u.pathname.split('/').filter(Boolean);
    const numSeg = /^\/(?:message|qr)\//i.test(u.pathname)
      ? undefined
      : [...segs].reverse().find((s) => /^\d{10,15}$/.test(s));
    if (host === 'wa.me' && (numSeg || /^\/(?:message|c|p|qr)\//i.test(u.pathname))) {
      out.whatsappLink = u.toString();
    }
    if (numSeg) out.phone = `+${numSeg}`;
    return out;
  }
  if (host === 'api.whatsapp.com' || host === 'web.whatsapp.com') {
    const out: { phone?: string; whatsappLink?: string } = {};
    const p = u.searchParams.get('phone') ?? '';
    const d = /^\+?\d{10,15}$/.test(p.trim()) ? p.trim().replace(/^\+/, '') : '';
    if (d || /^\/message(?:\/|$)/i.test(u.pathname)) {
      out.whatsappLink = u.toString();
    }
    if (d) out.phone = `+${d}`;
    return out;
  }
  // group/channel invite — a real whatsapp surface that never exposes a number
  if (host === 'chat.whatsapp.com' && /^\/[\w-]{10,}\/?$/i.test(u.pathname)) {
    return { whatsappLink: u.toString() };
  }
  // apex or the mobile profile host only — other subdomains (l., about.)
  // are redirect wrappers or corporate pages, not accounts.
  if (host === 'instagram.com' || host === 'm.instagram.com') {
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
  // parse the snippet for free before spending a fetch — fields fill
  // independently so a URL phone doesn't hide a snippet email
  if (r.snippet && (!out.phone || !out.email)) {
    const c = contactsFromText(r.snippet);
    if (!out.phone && c.phones[0]) out.phone = c.phones[0];
    if (!out.email && c.emails[0]) out.email = c.emails[0];
    if ((c.phones[0] || c.emails[0]) && out.kind === 'site') out.kind = 'contact';
  }
  return out;
}

/** annotate + dedupe by page identity, ordered contact > site > profile >
 *  listing, capped at 12 */
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

/** every contact channel a page's links encode — this segment's contact
 *  block is a row of icon links, not body text */
export function contactsFromLinks(links: string[]): FoundContacts {
  const out: FoundContacts = {
    phones: [],
    whatsappLinks: [],
    emails: [],
    instagram: [],
    facebook: [],
    tiktok: [],
    phoneHints: [],
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
      // BR tel: links publish DDD+number (10-11 digits) with no '+' — prefixing
      // '+' would fabricate a wrong country code, so local forms get +55
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

/** a url written out in prose — scheme optional for contact domains */
const TEXT_URL_RE = /https?:\/\/[^\s"'<>()[\]]+/gi;
const BARE_CONTACT_RE =
  /\b(?:[\w-]+\.)?(?:wa\.me|api\.whatsapp\.com|linktr\.ee|lnk\.bio|bio\.link|beacons\.ai|linklist\.bio|allmylinks\.com|msha\.ke|hoo\.be|carrd\.co|solo\.to|wa\.link|linkbio\.co|camps\.bio|flow\.page|bit\.ly|w\.app|cutt\.ly|tinyurl\.com|rebrand\.ly|short\.io)\/[^\s"'<>()[\]]*/gi;
const EMAIL_TEXT_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ASSET_TAIL_RE = /\.(?:png|jpe?g|gif|webp|svg|css|js|mjs|ico|woff2?|ttf|otf)$/i;
/** formatted BR phones — the required separator and \w-ish boundaries keep
 *  CNPJs/dates/prices out; bare contiguous digits only count in the 11-13
 *  mobile shape (a bare landline is indistinguishable from a 10-digit code) */
const PHONE_TEXT_RE =
  /(?<![\w@/.-])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]\d{4}(?![\w/-])|\b\+?(?:55)?\d{2}9\d{8}\b/g;
/** bare BR mobile with no DDD — undialable as-is, but proves a whatsapp
 *  exists; lands in phoneHints for the model to resolve */
const PHONE_HINT_RE = /(?<![\w@/.-])9[\s.-]?\d{4}[\s.-]\d{4}(?![\w/-])/g;

/** Normalize a phone-shaped match to +55…/intl, or null when it's not a
 *  callable-looking number (too short, weird country-less form). */
export function phoneFromText(raw: string): string | null {
  const d = digits(raw);
  // an explicit + already carries the country code — keep verbatim (E.164)
  if (/^\s*\(?\+/.test(raw)) {
    return d.length >= 8 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null;
  }
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return null;
}

/** BR mobile = whatsapp-reachable — 11-digit local form with a leading 9;
 *  landlines are not whatsapp */
export function isBrMobilePhone(phone: string): boolean {
  const d = digits(phone);
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  return local.length === 11 && local[2] === '9';
}

function isHubHost(host: string): boolean {
  // subdomain-aware: carrd.co sites are <name>.carrd.co — an exact-match set
  // would drop every one of them out of the hub path.
  return hostMatches(host, LINK_HUB_HOSTS);
}

/** profile-shaped url on a link-in-bio host — apex hubs carry the handle in
 *  the path (linktr.ee/x), subdomain hubs in the host (x.carrd.co) */
export function isProfileHubUrl(u: URL): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean).length;
  if (LINK_HUB_HOSTS.has(h) || SHORTENER_HOSTS.has(h)) return segs === 1;
  return hostMatches(h, LINK_HUB_HOSTS) && segs <= 1;
}

/** contacts printed in body text — same fields as contactsFromLinks, plus
 *  hub urls spotted in prose (instagram renders the bio link as text) */
export function contactsFromText(text: string): FoundContacts & { hubs: string[] } {
  const out: FoundContacts & { hubs: string[] } = {
    phones: [],
    whatsappLinks: [],
    emails: [],
    instagram: [],
    facebook: [],
    tiktok: [],
    phoneHints: [],
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
  const phoneSpans: [number, number][] = [];
  for (const m of text.matchAll(PHONE_TEXT_RE)) {
    const phone = phoneFromText(m[0]);
    if (phone) {
      uniqPush(out.phones, phone);
      phoneSpans.push([m.index, m.index + m[0].length]);
    }
    if (out.phones.length >= 6) break;
  }
  for (const m of text.matchAll(PHONE_HINT_RE)) {
    // a bare 9xxxx-xxxx sitting inside an already-captured full number
    // ("(22) 9968-8525" ends in one) is not a second contact surface.
    if (phoneSpans.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
    uniqPush(out.phoneHints, m[0]);
    if (out.phoneHints.length >= 4) break;
  }
  return out;
}

/** links most likely to carry contact info or the catalog — same-host
 *  contact-ish paths plus cross-host hubs, capped */
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
  // hubs first — for ig-first businesses the link-in-bio IS the contact page;
  // a hub's own pages are footer noise, so hub surfacing is profile-shaped only
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
      } else if (isBizMapUrl(u)) {
        // keep the query — /maps/search?q=<name> encodes the business in the
        // params; strip it and the pointer loses the entity
        push(`${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`);
      }
    }
  }
  if (!host) return out.slice(0, 8);
  if (isHubHost(host)) {
    // on a hub page same-host links are platform chrome — the worthwhile
    // follow-ups point OUT to the business's own domain
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
      // wa.me destinations are already in foundContacts — nav points at
      // pages worth another fetch
      if (c.phone || c.whatsappLink) continue;
      push(`${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || '/'}`);
      if (out.length >= 8) break;
    }
    return out.slice(0, 8);
  }
  // contact-ish paths first, catalog-ish backfill — otherwise a nav full of
  // product cards never surfaces /contato
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

/** pinned to TinyFish hosts over https — otherwise the config row is an SSRF
 *  primitive that exfiltrates the API key */
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

/** inet_aton semantics — 1–4 parts, decimal/octal/hex; catches every notation
 *  smuggled past string-prefix checks (0177.0.0.1, 0x7f…1, 2130706433) */
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

/** the provider fetches, not us — but an agent-controlled URL must still
 *  never name an internal or loopback host */
export function assertFetchable(url: string): URL {
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
      // Fetch API batches ≤10 urls per POST; per-URL failures land in
      // errors[] without sinking the batch
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
        // union all three surfaces: links (anchors), text (an ig bio's wa.me
        // is text), og:title/description (directories put "Telefone:" in meta)
        const fromLinks = contactsFromLinks(links);
        const fromText = contactsFromText(
          [text, r.title, r.description].filter(Boolean).join('\n'),
        );
        // the requested/resolved URL can itself be the contact — a shortener
        // redirect to wa.me/<digits> yields the phone for free
        const fromUrls = [r.final_url, url].flatMap((u) => {
          if (!u) return [];
          try {
            return [contactFromUrl(new URL(u))];
          } catch {
            return [];
          }
        });
        const foundContacts: FoundContacts = {
          phones: [
            ...new Set([
              ...fromLinks.phones,
              ...fromText.phones,
              ...fromUrls.flatMap((c) => (c.phone ? [c.phone] : [])),
            ]),
          ],
          whatsappLinks: [
            ...new Set([
              ...fromLinks.whatsappLinks,
              ...fromText.whatsappLinks,
              ...fromUrls.flatMap((c) => (c.whatsappLink ? [c.whatsappLink] : [])),
            ]),
          ],
          emails: [...new Set([...fromLinks.emails, ...fromText.emails])],
          instagram: [
            ...new Set([
              ...fromLinks.instagram,
              ...fromText.instagram,
              ...fromUrls.flatMap((c) => (c.instagram ? [c.instagram] : [])),
            ]),
          ],
          facebook: [...new Set([...fromLinks.facebook, ...fromText.facebook])],
          tiktok: [...new Set([...fromLinks.tiktok, ...fromText.tiktok])],
          phoneHints: [...new Set([...fromLinks.phoneHints, ...fromText.phoneHints])],
        };
        pages.push({
          url,
          ...(r.final_url && r.final_url !== url ? { finalUrl: r.final_url } : {}),
          title: r.title ?? null,
          description: r.description ?? null,
          text,
          // nav links belong to the rendered destination — compare same-host
          // against final_url, not the requested url
          nav: [...new Set([...navLinks(links, r.final_url ?? url), ...fromText.hubs])].slice(0, 8),
          ...(isTruncatedText(text) ? { truncated: true } : {}),
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
        phoneHints: [],
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

export function isMapPointer(url: string): boolean {
  try {
    return isBizMapUrl(new URL(url));
  } catch {
    return false;
  }
}

/** pointer-only surfaces that exist solely to hold the real contact —
 *  auto-chased so profile → hub → wa.me never costs a second model step */
export function chaseLinks(page: ReadPage): string[] {
  const out: string[] = [];
  for (const link of page.nav) {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      continue;
    }
    if (isHubHost(u.hostname.toLowerCase().replace(/^www\./, '')) || isBizMapUrl(u)) {
      out.push(link);
    }
  }
  return out;
}

/** iteratively peel `continue=` wrappers off a google-family url (a captcha'd
 *  /sorry/ redirect can nest), re-validating family + scheme each level;
 *  past the bound the url resolves through the fetch path instead */
function unwrapContinue(raw: string, max = 8): string {
  let cur = raw;
  for (let i = 0; i < max; i++) {
    let t: URL;
    try {
      t = new URL(cur);
    } catch {
      break;
    }
    if (t.protocol !== 'http:' && t.protocol !== 'https:') break;
    if (!isBizMapUrl(t) && !GOOGLE_HOST.test(t.hostname)) break;
    // get() already decodes once — decode again only when the result is
    // itself a complete url; a duplicated continue= follows its first
    // nonempty value (an empty slot isn't a wrapper)
    const inner = t.searchParams.getAll('continue').find((v) => v);
    if (!inner) break;
    try {
      let target = inner;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(inner)) {
        const dec = decodeURIComponent(inner);
        if (/^https?:\/\//i.test(dec)) target = dec;
      }
      const cand = new URL(target, cur);
      // the peel never crosses the pointer family — a continue= resolving
      // outside biz-map/google keeps the wrapper unresolved (leftover
      // continue= marks it) and never becomes a chase hop
      if (
        (cand.protocol !== 'http:' && cand.protocol !== 'https:') ||
        (!isBizMapUrl(cand) && !GOOGLE_HOST.test(cand.hostname))
      ) {
        break;
      }
      cur = cand.toString();
    } catch {
      break;
    }
  }
  return cur;
}

/** the carrier a maps/google url peels to, plus the business name it already
 *  carries (?q=, /maps/place/) — null name when only a redirect could reveal it */
function mapPointerCarrier(raw: string): { carrier: URL; name: string | null } | null {
  try {
    const t = new URL(unwrapContinue(raw));
    // only the map-pointer/google family can carry a business name, and the
    // carrier must be fetchable (ftp://maps.google.com is not a pointer)
    if (t.protocol !== 'http:' && t.protocol !== 'https:') return null;
    if (!isBizMapUrl(t) && !GOOGLE_HOST.test(t.hostname)) return null;
    // a leftover nonempty continue= means the peel hit its bound mid-chain —
    // the wrapper's ?q=/place fields describe the wrapper, not the destination
    if (t.searchParams.getAll('continue').some((v) => v)) return { carrier: t, name: null };
    const q = t.searchParams.get('q') ?? t.searchParams.get('query');
    let name: string | null = null;
    if (q && !/\//.test(q) && q.length < 80) name = q.replace(/\+/g, ' ');
    if (!name) {
      const m = /\/maps\/place\/([^/]+)/.exec(t.pathname);
      name = m ? decodeURIComponent(m[1]!).replace(/\+/g, ' ') : null;
    }
    return { carrier: t, name };
  } catch {
    return null;
  }
}

/** The business name a maps/google URL already carries (?q=, /maps/place/),
 *  or null when only a redirect hop could reveal it — the difference
 *  between resolving a pointer in-process and spending a real fetch. */
export function mapPointerName(raw: string): string | null {
  return mapPointerCarrier(raw)?.name ?? null;
}

/** a g.co/kgs or maps shortlink can't be provider-fetched (captcha wall) but
 *  its 302 target carries the canonical entity (?q=<name>, /maps/place/) —
 *  resolve in-process into a synthetic page naming the business */
export async function resolveMapPointer(
  url: string,
  // fetch-budget hook — called before each request is issued; false stops
  // the chase (a nameable pointer never triggers it — those resolve free)
  reserve?: () => Promise<boolean>,
): Promise<ReadPage | null> {
  // only shortlinks need the 302 resolved; redirects are followed only while
  // the target stays in the shortlink/google family
  const SHORTLINK_HOST = /^(g\.co|maps\.app\.goo\.gl|.*\.goo\.gl|bit\.ly|tinyurl\.com|t\.co)$/i;
  // peel continue= wrappers off the input too; when a name is found the peeled
  // carrier is the resolved location (the original url stays the page identity)
  const init = mapPointerCarrier(url);
  let location: string | null = init?.name ? init.carrier.toString() : null;
  let name: string | null = init?.name ?? null;
  let next: string | null = unwrapContinue(url);
  for (let hops = 0; !location && next && hops < 3; hops++) {
    // every hop runs the same guard read_pages applies — a shortlink can
    // 302 to a private/non-http target its host check would never name
    try {
      assertFetchable(next);
    } catch {
      break;
    }
    // charge before issuing — a pointer can burn several hops of fetch budget
    if (reserve && !(await reserve())) break;
    let redirect: string | null = null;
    try {
      const res = await fetch(next, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      redirect = res.headers.get('location');
    } catch {
      break;
    }
    if (!redirect) break;
    let t: URL;
    try {
      t = new URL(redirect, next);
    } catch {
      break;
    }
    // the redirect may land on another sorry/ wrapper — peel it so the
    // location handed to the model is the real target, not the captcha wall
    const peeled = unwrapContinue(t.toString());
    try {
      t = new URL(peeled);
    } catch {
      break;
    }
    const p = mapPointerCarrier(peeled);
    name = p?.name ?? name;
    // a named carrier IS the resolved destination — no further hop needed
    if (p?.name) {
      try {
        assertFetchable(p.carrier.toString());
        location = p.carrier.toString();
      } catch {
        /* fall through: keep whatever name we found, no location */
      }
      break;
    }
    if (GOOGLE_HOST.test(t.hostname)) {
      // a peeled target that still wraps a continue= is another captcha
      // carrier — never the resolved location, but its redirect can advance
      // the chain
      if (t.searchParams.getAll('continue').some((v) => v)) {
        next = t.toString();
        continue;
      }
      // the resolved location reaches the model as a follow-up url — it must
      // pass the fetchable guard too, not just the family check
      try {
        assertFetchable(t.toString());
      } catch {
        break;
      }
      location = t.toString();
      break;
    }
    // a foreign target is never fetched and its url never reaches the model
    next = SHORTLINK_HOST.test(t.hostname) ? t.toString() : null;
  }
  if (!location && !name) return null;
  return {
    url,
    finalUrl: location ?? url,
    title: name ? `Google Business: ${name}` : 'Google Business/maps',
    description: null,
    text: name
      ? `Perfil de negócio no Google de "${name}" — google.com/maps/search bloqueia fetch de bot, mas o telefone consta no perfil. web_search "${name}" + cidade + telefone expõe o número via diretórios e o próprio painel.`
      : `Link de Google Business/maps — fetch de bot bloqueado por captcha; busque o negócio por nome + cidade + telefone.`,
    nav: [],
    foundContacts: {
      phones: [],
      whatsappLinks: [],
      emails: [],
      instagram: [],
      facebook: [],
      tiktok: [],
      phoneHints: [],
    },
  };
}

/** the provider's render stopped early — the bio's contact line lives past
 *  the cut; flag so the model switches to search + directories */
function isTruncatedText(text: string): boolean {
  const tail = text.trim().slice(-80);
  return (
    /(?:\.\.|…)\s*$/.test(tail) ||
    /(?:^|\n)\s*(?:mais|more|ver mais|see more)\.?\.?\.?\s*$/i.test(tail)
  );
}

export async function discoveryFor(sql: Sql): Promise<DiscoveryProvider> {
  const integration = await getIntegration(sql, 'discovery');
  if (!integration || !integration.enabled) return mock();
  if (integration.driver === 'tinyfish') return tinyfish(integration);
  return mock();
}
