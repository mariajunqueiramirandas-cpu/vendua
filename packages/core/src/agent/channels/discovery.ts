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
  /** page content as markdown, bounded for context size */
  text: string;
  /** true when text was cut at the context cap */
  truncated?: boolean;
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
  /** directory/aggregator (ifood, guia) — lead signal, weak contact source */
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
// internal links that usually carry contact info or the catalog — these are
// the follow-up reads worth spending a fetch on.
const NAV_HINT =
  /contato|contact|sobre|about|quem-somos|cardapio|card[aá]pio|menu|produtos|products|encomend|pedido|order|or[cç]amento|delivery|loja|shop|atendimento|unidades|visite-nos|where/i;

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

/** Pull whatever the URL itself encodes: phone out of wa.me/whatsapp deep
 *  links, handle out of profile roots. Returns null fields otherwise. */
export function contactFromUrl(u: URL): { phone?: string; instagram?: string } {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'wa.me' || host === 'whatsapp.com') {
    const d = digits(u.pathname);
    if (d.length >= 10) return { phone: `+${d}` };
  }
  if (host === 'api.whatsapp.com') {
    const d = digits(u.searchParams.get('phone') ?? '');
    if (d.length >= 10) return { phone: `+${d}` };
  }
  if (host === 'instagram.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 1 && !PROFILE_STOP.has(seg[0]!.toLowerCase())) {
      return { instagram: `@${seg[0]}` };
    }
  }
  return {};
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
  if (contact.phone) return { ...base, kind: 'contact', phone: contact.phone };
  if (contact.instagram) return { ...base, kind: 'profile', instagram: contact.instagram };
  if (PROFILE_HOSTS.has(host)) return { ...base, kind: 'profile' };
  if (LISTING_HOSTS.has(host) || host.endsWith('.gov.br') || host.endsWith('.gov')) {
    return { ...base, kind: 'listing' };
  }
  return base;
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

/** How much of a fetched page's markdown the model sees — enough for the
 *  contact/about sections that matter, small enough to batch several pages
 *  per step. */
const PAGE_TEXT_CAP = 4000;

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
  for (const raw of links) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.protocol === 'mailto:') {
      const email = decodeURIComponent(u.pathname).trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) uniqPush(out.emails, email);
      continue;
    }
    if (u.protocol === 'tel:') {
      const d = digits(u.pathname);
      if (d.length >= 8) uniqPush(out.phones, `+${d}`);
      continue;
    }
    const wa = contactFromUrl(u);
    if (wa.phone) {
      uniqPush(out.phones, wa.phone);
      uniqPush(out.whatsappLinks, raw);
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

/** The internal links most likely to carry contact info or the catalog —
 *  surfaced so the model can queue a follow-up read without re-fetching junk
 *  (blog posts, product detail pages, anchors). Same-host only, capped. */
export function navLinks(links: string[], pageUrl: string): string[] {
  const host = hostOf(pageUrl);
  if (!host) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const h = hostOf(raw);
    if (h !== host) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (!NAV_HINT.test(path)) continue;
    const key = `${host}${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${u.protocol}//${u.host}${path}`);
    if (out.length >= 8) break;
  }
  return out;
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

/** The provider fetches the page, not us — but an agent-controlled URL
 *  should still never name an internal or loopback host. */
function assertFetchable(url: string): URL {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`unsupported url scheme ${target.protocol}`);
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateHost =
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '169.254.169.254' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // hex/octal/long-int hosts that resolve to loopback-adjacent IPs
    /^0x/i.test(host) ||
    /^\d+$/.test(host);
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
        pages.push({
          url,
          ...(r.final_url && r.final_url !== url ? { finalUrl: r.final_url } : {}),
          title: r.title ?? null,
          description: r.description ?? null,
          text: text.slice(0, PAGE_TEXT_CAP),
          ...(text.length > PAGE_TEXT_CAP ? { truncated: true } : {}),
          nav: navLinks(links, url),
          foundContacts: contactsFromLinks(links),
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
