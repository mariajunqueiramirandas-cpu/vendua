import type { Context, Hono } from 'hono';
import { customerRowsTx, roundUsd } from '../modules/control-customers.ts';
import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { AGENTS } from './agents/index.ts';

// /control/v1/ai (CRM "IA"): which models Duá runs on and what it costs. Routes and budgets are
// written through PUT /control/v1/settings/agent_runtime.{routes,budgets} (validateSetting).

/** the keys adaptersFromEnv (models.ts) builds a provider from */
const PROVIDERS = [
  { id: 'anthropic', secretName: 'ANTHROPIC_API_KEY' },
  { id: 'openrouter', secretName: 'OPENROUTER_API_KEY' },
  { id: 'openai', secretName: 'OPENAI_API_KEY' },
  { id: 'gemini', secretName: 'GEMINI_API_KEY' },
] as const;

const LABELS: Record<string, string> = {
  vendedor: 'Duá (vendedor)',
  'vendedor-onboarding': 'Duá (configuração inicial)',
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** AGENT_MODEL_ROUTES as settingRoutes reads it; null when it names no route at all */
function envRoutes(raw: string | undefined): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw ?? '') as unknown;
    return isObject(v) && Object.keys(v).length ? v : null;
  } catch {
    return null;
  }
}

/** the store's daily USD cap for a budget key, as pgSpend reads it */
function dailyLimit(budgets: Record<string, unknown>, tenantId: string, key: string) {
  const tenants = isObject(budgets.tenants) ? budgets.tenants : {};
  const own = isObject(tenants[tenantId]) ? tenants[tenantId][key] : undefined;
  const v = own ?? budgets[key];
  return typeof v === 'number' && v >= 0 ? v : null;
}

export function mountAgentRuntimeAi(o: {
  app: Hono<any>;
  sql: Sql;
  controlGate: (c: Context) => void;
  storeDomain?: string;
  /** where provider keys and AGENT_MODEL_ROUTES are read (default process.env) */
  env?: Record<string, string | undefined>;
}) {
  const { app, sql, controlGate } = o;
  const env = o.env ?? process.env;
  const storeDomain = o.storeDomain ?? process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';
  const settings = (tx: Sql) => tx<{ key: string; value: Record<string, unknown> }[]>`
    select key, value from control_settings
    where key in ('agent_runtime.routes', 'agent_runtime.budgets')
  `;

  app.get('/control/v1/ai/models', async (c) => {
    controlGate(c);
    const rows = await controlTx(sql, settings);
    const routesRow = rows.find((r) => r.key === 'agent_runtime.routes');
    const fromEnv = routesRow ? null : envRoutes(env.AGENT_MODEL_ROUTES);
    return c.json({
      routes: routesRow?.value ?? fromEnv ?? {},
      routesSource: routesRow ? 'settings' : fromEnv ? 'env' : 'none',
      budgets: rows.find((r) => r.key === 'agent_runtime.budgets')?.value ?? {},
      providers: PROVIDERS.map((p) => ({
        id: p.id,
        configured: !!env[p.secretName],
        secretName: p.secretName,
      })),
      agents: AGENTS.map(({ def }) => ({
        id: def.id,
        label: LABELS[def.id] ?? def.id,
        budgetKey: def.budgets?.tenantDaily ?? null,
        defaultTier: def.models.default,
      })),
    });
  });

  app.get('/control/v1/ai/usage', async (c) => {
    controlGate(c);
    const raw = c.req.query('days') ?? '30';
    if (raw !== '7' && raw !== '30')
      throw new HttpError(422, 'BAD_REQUEST', 'days must be 7 or 30', { field: 'days' });
    const days = Number(raw) as 7 | 30;
    const budgetKey =
      AGENTS.find((a) => a.def.id === 'vendedor')?.def.budgets?.tenantDaily ?? 'vendedor';
    const out = await controlTx(sql, async (tx) => {
      const now = new Date();
      // whole São Paulo days, the window the Visão and store charts use
      const since = (
        await tx<{ since: Date }[]>`
          select (((${now}::timestamptz at time zone 'America/Sao_Paulo')::date - ${days - 1}::int)::timestamp
                  at time zone 'America/Sao_Paulo') as since`
      )[0]!.since;
      const [calls, convs, set, stores] = await Promise.all([
        tx<
          {
            tenant_id: string;
            provider: string;
            model: string;
            calls: number;
            usd: number;
            input: number;
            output: number;
          }[]
        >`
          select e.tenant_id, coalesce(e.payload ->> 'provider', '?') as provider,
                 coalesce(e.payload ->> 'model', '?') as model, count(*)::int as calls,
                 coalesce(sum((e.payload -> 'usage' ->> 'costUsd')::float8), 0)::float8 as usd,
                 coalesce(sum((e.payload -> 'usage' ->> 'inputTokens')::numeric), 0)::float8 as input,
                 coalesce(sum((e.payload -> 'usage' ->> 'outputTokens')::numeric), 0)::float8 as output
          from agent_events e
          where e.type = 'model.responded' and e.at >= ${since}
          group by 1, 2, 3
        `,
        tx<{ tenant_id: string; n: number }[]>`
          select tenant_id, count(*)::int as n from ai_conversations
          where started_at >= ${since} group by tenant_id
        `,
        settings(tx),
        customerRowsTx(tx, { storeDomain, now }),
      ]);
      const budgets = set.find((r) => r.key === 'agent_runtime.budgets')?.value ?? {};
      const convBy = new Map(convs.map((r) => [r.tenant_id, r.n]));
      const models = new Map<
        string,
        { provider: string; model: string; calls: number; usd: number }
      >();
      const byTenant = new Map<string, { calls: number; usd: number }>();
      const totals = { calls: 0, usd: 0, conversations: 0, inputTokens: 0, outputTokens: 0 };
      for (const r of calls) {
        const k = `${r.provider}\u0000${r.model}`;
        const m = models.get(k) ?? { provider: r.provider, model: r.model, calls: 0, usd: 0 };
        m.calls += r.calls;
        m.usd += r.usd;
        models.set(k, m);
        const t = byTenant.get(r.tenant_id) ?? { calls: 0, usd: 0 };
        t.calls += r.calls;
        t.usd += r.usd;
        byTenant.set(r.tenant_id, t);
        totals.calls += r.calls;
        totals.usd += r.usd;
        totals.inputTokens += r.input;
        totals.outputTokens += r.output;
      }
      for (const r of convs) totals.conversations += r.n;
      const byStore = stores
        .map((s) => {
          const t = byTenant.get(s.id);
          return {
            id: s.id,
            slug: s.slug,
            name: s.name,
            calls: t?.calls ?? 0,
            usd: roundUsd(t?.usd ?? 0),
            conversations: convBy.get(s.id) ?? 0,
            used: s.ai.used,
            limit: s.ai.limit,
            remaining: s.ai.remaining,
            dailyLimitUsd: dailyLimit(budgets, s.id, budgetKey),
            included: s.ai.included,
          };
        })
        .filter((s) => s.included || s.calls > 0 || s.conversations > 0)
        .sort((a, b) => b.usd - a.usd || b.conversations - a.conversations || b.used - a.used)
        .map(({ included: _, ...s }) => s);
      return {
        days,
        totals: { ...totals, usd: roundUsd(totals.usd) },
        byModel: [...models.values()]
          .map((m) => ({ ...m, usd: roundUsd(m.usd) }))
          .sort((a, b) => b.usd - a.usd || b.calls - a.calls),
        byStore,
      };
    });
    c.header('cache-control', 'no-store');
    return c.json(out);
  });
}
