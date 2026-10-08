import {
  createGateway,
  openAiCompatibleAdapter,
  type ModelGateway,
  type ModelRoute,
  type ProviderAdapter,
  type RouteResolver,
  type Tier,
} from '@vendua/agent-runtime';
import { controlTx } from '../modules/control.ts';
import { ANTHROPIC_MODEL, ANTHROPIC_PRICING, isEffort } from '../platform/anthropic.ts';
import type { Sql } from '../platform/db.ts';
import { anthropicAdapter } from './anthropic.ts';

/**
 * Model routes, set by staff in `control_settings` key `agent_runtime.routes`:
 *   { "default": { "fast": [route…], "strong": [route…] },
 *     "agents":  { "<agentId>": { "fast": […] } },
 *     "tenants": { "<tenantId>": { "strong": […] } } }
 * a route is { provider, model, zdr, endpoint?, effort?, pricing?, timeoutMs? }. The most specific list wins. `zdr`
 * (zero data retention) is staff's per-route choice since 2026-10-05 (default on in the CRM):
 * OpenRouter enforces it per request when on; on a direct provider it's the account's contract.
 * With no setting, `AGENT_MODEL_ROUTES` (same JSON) is the fallback.
 */
type TierRoutes = Partial<Record<Tier, ModelRoute[]>>;
interface RoutesSetting {
  default?: TierRoutes;
  agents?: Record<string, TierRoutes>;
  tenants?: Record<string, TierRoutes>;
}

const CACHE_MS = 30_000;

export function routesFrom(
  setting: RoutesSetting,
  tenantId: string,
  agentId: string,
  tier: Tier,
): ModelRoute[] {
  return (
    setting.tenants?.[tenantId]?.[tier] ??
    setting.agents?.[agentId]?.[tier] ??
    setting.default?.[tier] ??
    []
  )
    .filter(
      (r) =>
        r &&
        typeof r.provider === 'string' &&
        typeof r.model === 'string' &&
        // AGENT_MODEL_ROUTES never goes through validateSetting: a route that doesn't say whether
        // it wants zero retention isn't guessed at
        typeof r.zdr === 'boolean' &&
        (r.endpoint === undefined || typeof r.endpoint === 'string'),
    )
    .map((r) => {
      const { effort, ...rest } = r;
      if (r.provider !== 'anthropic') return rest;
      // the adapter runs ANTHROPIC_MODEL whatever the route says: price the estimate by it too
      return {
        ...rest,
        model: ANTHROPIC_MODEL,
        pricing: ANTHROPIC_PRICING,
        ...(isEffort(effort) ? { effort } : {}),
      };
    });
}

export function settingRoutes(sql: Sql): RouteResolver {
  let cached: { at: number; value: RoutesSetting } | null = null;
  const envFallback = (): RoutesSetting => {
    try {
      return JSON.parse(process.env.AGENT_MODEL_ROUTES ?? '{}') as RoutesSetting;
    } catch {
      return {};
    }
  };
  return {
    async routes(tenantId, agentId, tier) {
      if (!cached || Date.now() - cached.at > CACHE_MS) {
        const rows = await controlTx(
          sql,
          (tx) => tx<{ value: RoutesSetting }[]>`
          select value from control_settings where key = 'agent_runtime.routes'`,
        );
        cached = { at: Date.now(), value: rows[0]?.value ?? envFallback() };
      }
      return routesFrom(cached.value, tenantId, agentId, tier);
    },
  };
}

/** Provider adapters for the keys this process has. ZDR is per route, not per adapter. */
export function adaptersFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderAdapter[] {
  const out: ProviderAdapter[] = [];
  if (env.ANTHROPIC_API_KEY) out.push(anthropicAdapter({ apiKey: env.ANTHROPIC_API_KEY }));
  if (env.OPENROUTER_API_KEY)
    out.push(
      openAiCompatibleAdapter({
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        // never a provider that trains on what Duá sends; a `zdr` route also only endpoints with a
        // zero-data-retention policy
        extraBody: { provider: { data_collection: 'deny' } },
        zdrBody: { provider: { zdr: true, data_collection: 'deny' } },
        // a pinned route means that endpoint: the route list is the fallback chain, not OpenRouter's
        endpointBody: (tag) => ({ provider: { order: [tag], allow_fallbacks: false } }),
        cacheMarkers: true,
      }),
    );
  if (env.OPENAI_API_KEY)
    out.push(
      openAiCompatibleAdapter({
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        maxTokensField: 'max_completion_tokens',
      }),
    );
  if (env.GEMINI_API_KEY)
    out.push(
      openAiCompatibleAdapter({
        id: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: env.GEMINI_API_KEY,
      }),
    );
  return out;
}

export function hostGateway(
  sql: Sql,
  adapters: ProviderAdapter[] = adaptersFromEnv(),
): ModelGateway {
  return createGateway({ adapters, routes: settingRoutes(sql) });
}
