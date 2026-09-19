import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';

/**
 * agent/channels/discovery — TinyFish driver. Search API for prospect
 * queries (GET api.search.tinyfish.ai), Agent API (automation/run-async)
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

function tinyfish(integration: IntegrationRow): DiscoveryProvider {
  const secretRef = integration.secret_ref;
  const apiKey = (secretRef && process.env[secretRef]) ?? process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error(`tinyfish driver: missing ${secretRef ?? 'TINYFISH_API_KEY'}`);
  const searchBase = (integration.config.searchUrl as string) ?? 'https://api.search.tinyfish.ai';
  const agentBase = (integration.config.agentUrl as string) ?? 'https://agent.tinyfish.ai/v1';
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
      const res = await fetch(`${agentBase}/automation/run-async`, {
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
      // run-async returns a job handle; poll is the caller's concern in a
      // real deployment. For the lightweight path, treat the response as
      // the completed extraction when it carries contacts, else empty.
      const data = (await res.json()) as {
        output?: ExtractResult;
        contacts?: ExtractResult['contacts'];
      };
      if (data.output?.contacts) return { contacts: data.output.contacts };
      return { contacts: data.contacts ?? [], raw: JSON.stringify(data).slice(0, 2000) };
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
