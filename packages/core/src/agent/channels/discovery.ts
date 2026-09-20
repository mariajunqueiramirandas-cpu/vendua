import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';

/**
 * agent/channels/discovery — TinyFish driver. Search API for prospect
 * queries (GET api.search.tinyfish.ai), Agent API (automation/run)
 * for structured extraction from found pages. `mock` driver returns canned
 * prospects so discovery runs end-to-end with no credentials.
 */

export interface DiscoveryResult {
  results: { title: string; url: string; snippet?: string }[];
}
export interface ExtractResult {
  contacts: {
    name?: string;
    phone?: string;
    instagram?: string;
    website?: string;
    email?: string;
    businessName?: string;
    city?: string;
  }[];
  raw?: string;
}
export interface DiscoveryProvider {
  search(query: string, purpose: string): Promise<DiscoveryResult>;
  extract(url: string, goal: string): Promise<ExtractResult>;
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
  /** own-domain page — the only kind worth an extract_page call */
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
      .map(([k, v]) => `${k}=${v}`)
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

function tinyfish(integration: IntegrationRow): DiscoveryProvider {
  const secretRef = integration.secret_ref;
  const apiKey = (secretRef && process.env[secretRef]) ?? process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error(`tinyfish driver: missing ${secretRef ?? 'TINYFISH_API_KEY'}`);
  const searchBase = tinyfishBase(integration.config.searchUrl, 'https://api.search.tinyfish.ai');
  const agentBase = tinyfishBase(integration.config.agentUrl, 'https://agent.tinyfish.ai/v1');
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
    async extract(url, goal) {
      // Only http(s) targets — the goal text is never parsed as a URL but
      // `url` comes from search output or the agent and must not fetch
      // internal/loopback hosts.
      const target = new URL(url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error(`tinyfish extract: unsupported url scheme ${target.protocol}`);
      }
      // The provider fetches the page, not us — but an agent-controlled URL
      // should still never name an internal or loopback host.
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
        throw new Error(`tinyfish extract: private/internal target not allowed: ${host}`);
      }
      // Synchronous /run blocks until the automation completes — the right
      // fit inside a discovery run's extract loop (run-async would need a
      // separate poller for GET /v1/runs/{id}).
      const res = await fetch(`${agentBase}/automation/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          url,
          goal,
          output_schema: {
            type: 'object',
            properties: {
              contacts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    phone: { type: 'string' },
                    instagram: { type: 'string' },
                    website: { type: 'string' },
                    email: { type: 'string' },
                    businessName: { type: 'string' },
                    city: { type: 'string' },
                  },
                },
              },
            },
          },
        }),
      });
      if (!res.ok)
        throw new Error(`tinyfish extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        status?: string;
        result?: ExtractResult;
        error?: { message?: string };
      };
      if (data.status && data.status !== 'COMPLETED') {
        throw new Error(`tinyfish extract ${data.status}: ${data.error?.message ?? 'no result'}`);
      }
      return { contacts: data.result?.contacts ?? [] };
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
    async extract(url) {
      return {
        contacts: [
          {
            businessName: 'Doceria Aurora',
            instagram: '@doceria.aurora',
            phone: '+5585999990001',
            city: 'Fortaleza',
            website: url,
          },
        ],
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
