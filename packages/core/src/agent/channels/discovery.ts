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

/** Base URLs are configurable per-integration but pinned to TinyFish hosts
 *  over https — otherwise the config row becomes an SSRF primitive that
 *  exfiltrates the API key to an arbitrary endpoint. */
function tinyfishBase(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' && raw ? raw : fallback;
  const u = new URL(value);
  if (u.protocol !== 'https:' || !(u.hostname === 'tinyfish.ai' || u.hostname.endsWith('.tinyfish.ai'))) {
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
