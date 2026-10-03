import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGateway, type ProviderAdapter } from '@vendua/agent-runtime';
import { adaptersFromEnv } from '../../agent-host/models.ts';
import { createSql, migrate } from '../../platform/db.ts';
import { runSuite } from './run.ts';

// `bun run sims:vendedor` — the Vendedor's order-accuracy suite on live models (paid). Every
// prompt, tool or model change runs it; the gate is accuracy ≥ 98% and every scenario passing
// on all k runs (sales-agent.md §8 V2 exit gate, a proposal).
//
//   SIM_DATABASE_URL (default: TEST_DATABASE_URL)  — a migrated database; stores are created fresh
//   AGENT_MODEL_ROUTES='{"default":{"fast":[{"provider":"anthropic","model":"…","zdr":true}],"strong":[…]}}'
//   SIM_USER_ROUTES  (same shape; default: the agent's routes) — the simulated shoppers' models
//   plus the provider keys (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, …)
//   SIM_RPM (default 0 = unthrottled) and SIM_MAX_REQUESTS — a free tier's limits (e.g. 15 and 450)
//   bun run sims:vendedor -- [--k 3] [--only pizzaria,acai] [--pick "meia calabresa"]
//
// With only GEMINI_API_KEY and no AGENT_MODEL_ROUTES, both sides use SIM_GEMINI_MODEL. The suite
// sends synthetic fixture stores only, never a store's or a shopper's data, which is why a test
// key outside a zero-data-retention arrangement may serve it; never put such a route in
// production's agent_runtime.routes.

const url = process.env.SIM_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) throw new Error('set SIM_DATABASE_URL or TEST_DATABASE_URL');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

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
const adapters = adaptersFromEnv().map((a) =>
  throttled(a, Number(process.env.SIM_RPM ?? 0), Number(process.env.SIM_MAX_REQUESTS ?? 0)),
);
if (!process.env.AGENT_MODEL_ROUTES && process.env.GEMINI_API_KEY) {
  const route = {
    provider: 'gemini',
    model: process.env.SIM_GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
    zdr: true,
  };
  process.env.AGENT_MODEL_ROUTES = JSON.stringify({ default: { fast: [route], strong: [route] } });
}
if (!adapters.length) {
  console.error('no provider keys in env: the suite needs a live model (ZDR routes only)');
  process.exit(2);
}
const agentGateway = createGateway({ adapters, routes: routesOf(process.env.AGENT_MODEL_ROUTES) });
const userGateway = createGateway({
  adapters,
  routes: routesOf(process.env.SIM_USER_ROUTES ?? process.env.AGENT_MODEL_ROUTES),
});

const sql = createSql(url);
await migrate(sql, join(import.meta.dir, '../../../db/migrations'));
const result = await runSuite(sql, {
  agentGateway,
  userGateway,
  k: Number(arg('k') ?? 3),
  ...(arg('only') ? { only: arg('only')!.split(',') } : {}),
  ...(arg('pick') ? { pick: (_store: string, name: string) => name.includes(arg('pick')!) } : {}),
  log: (s) => console.log(s),
  ...(process.env.SIM_RPM ? { turnWaitMs: 240_000 } : {}),
});
const dir = join(import.meta.dir, '../../../sim-results');
await mkdir(dir, { recursive: true });
const file = join(dir, `vendedor-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(result, null, 2));
console.log(
  `\naccuracy ${(result.accuracy * 100).toFixed(1)}% · pass^${result.k} ${result.scenarios.filter((s) => s.passed).length}/${result.scenarios.length} · ${file}`,
);
await sql.end();
process.exit(result.passedAll && result.accuracy >= 0.98 ? 0 : 1);
