import { createGateway, type ModelGateway, type ProviderAdapter } from '@vendua/agent-runtime';
import { adaptersFromEnv } from './models.ts';

// The model side of the live sims (`sims:vendedor`, `sims:crm`): the agent's gateway and the
// simulated person's, from env.
//
//   AGENT_MODEL_ROUTES='{"default":{"fast":[{"provider":"anthropic","model":"…","zdr":true}],"strong":[…]}}'
//   SIM_USER_ROUTES  (same shape; default: the agent's routes) — the simulated people's models
//   plus the provider keys (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, …)
//   SIM_RPM (default 0 = unthrottled) and SIM_MAX_REQUESTS — a free tier's limits (e.g. 15 and 450)
//
// With only GEMINI_API_KEY and no AGENT_MODEL_ROUTES, both sides use SIM_GEMINI_MODEL. The sims
// send synthetic fixtures only, which is why a test key outside a zero-data-retention arrangement
// may serve them; never put such a route in production's agent_runtime.routes.

const routesOf = (json: string | undefined) => {
  const v = JSON.parse(json ?? '{}') as { default?: Record<string, unknown[]> };
  return {
    routes: async (_t: string, _a: string, tier: 'fast' | 'strong') =>
      (v.default?.[tier] ?? v.default?.fast ?? []) as never[],
  };
};

/** Spaces requests to a rate limit and stops before a daily quota, across both sides. */
function throttled(a: ProviderAdapter, rpm: number, max: number): ProviderAdapter {
  let next = 0;
  let used = 0;
  const gap = rpm > 0 ? Math.ceil(60_000 / rpm) : 0;
  return {
    id: a.id,
    ...(a.outputTokens ? { outputTokens: a.outputTokens.bind(a) } : {}),
    async generate(req, signal) {
      if (max && used >= max) throw new Error(`SIM_MAX_REQUESTS (${max}) reached`);
      used++;
      const wait = next - Date.now();
      next = Math.max(Date.now(), next) + gap;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return a.generate(req, signal);
    },
  };
}

/** null when no provider key is set: the sims need a live model. */
export function simGateways(): {
  agentGateway: ModelGateway;
  userGateway: ModelGateway;
  models: string;
} | null {
  const adapters = adaptersFromEnv().map((a) =>
    throttled(a, Number(process.env.SIM_RPM ?? 0), Number(process.env.SIM_MAX_REQUESTS ?? 0)),
  );
  if (!process.env.AGENT_MODEL_ROUTES && process.env.GEMINI_API_KEY) {
    const route = {
      provider: 'gemini',
      model: process.env.SIM_GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
      zdr: true,
    };
    process.env.AGENT_MODEL_ROUTES = JSON.stringify({
      default: { fast: [route], strong: [route] },
    });
  }
  if (!adapters.length) return null;
  return {
    agentGateway: createGateway({ adapters, routes: routesOf(process.env.AGENT_MODEL_ROUTES) }),
    userGateway: createGateway({
      adapters,
      routes: routesOf(process.env.SIM_USER_ROUTES ?? process.env.AGENT_MODEL_ROUTES),
    }),
    models: adapters.map((a) => a.id).join(','),
  };
}
