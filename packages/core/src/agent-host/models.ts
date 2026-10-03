import {
  anthropicAdapter,
  createGateway,
  openAiCompatibleAdapter,
  type ModelGateway,
  type ModelRoute,
  type ProviderAdapter,
  type RouteResolver,
  type Tier,
} from '@vendua/agent-runtime';
import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';

/**
 * Model routes, set by staff in `control_settings` key `agent_runtime.routes`:
 *   { "default": { "fast": [route…], "strong": [route…] },
 *     "agents":  { "<agentId>": { "fast": […] } },
 *     "tenants": { "<tenantId>": { "strong": […] } } }
 * a route is { provider, model, zdr, pricing?, timeoutMs? }. The most specific list wins, and the
 * gateway refuses any route whose `zdr` isn't true (the owner's rule, 2026-10-03). With no
 * setting, `AGENT_MODEL_ROUTES` (same JSON) is the fallback.
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
  ).filter((r) => r && typeof r.provider === 'string' && typeof r.model === 'string');
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
        // only endpoints with a zero-data-retention policy, and never for training
        extraBody: { provider: { zdr: true, data_collection: 'deny' } },
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
