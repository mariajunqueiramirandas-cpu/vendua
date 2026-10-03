import { Runtime, type Clock, type ModelGateway } from '@vendua/agent-runtime';
import { vendedor } from '../../agent-host/agents/vendedor/index.ts';
import { hostHooks } from '../../agent-host/hooks.ts';
import { pgMemory } from '../../agent-host/store/memory.ts';
import { PgActorStore } from '../../agent-host/store/pg-store.ts';
import type { Sql } from '../../platform/db.ts';
import { runScenario, type ScenarioResult } from '../cliente-oculto.ts';
import { configureVendedor } from '../deps.ts';
import { ingestPass } from '../ingest.ts';
import { vendedorTransport } from '../transport.ts';
import { createFixtureStore, FIXTURES, type StoreFixture } from './fixtures.ts';

// The order-accuracy suite (sales-agent.md §7): each fixture store × scenario runs k times
// against the real Vendedor (ingest, runtime, tools, checkout dry runs in test threads) with a
// simulated shopper holding a hidden target order. A scenario passes only if every run passes
// (pass^k). Scoring is code (`cliente-oculto.ts` score), never a model's opinion.

export interface SuiteResult {
  k: number;
  scenarios: { store: string; name: string; runs: ScenarioResult[]; passed: boolean }[];
  accuracy: number;
  passedAll: boolean;
}

export async function runSuite(
  sql: Sql,
  o: {
    agentGateway: ModelGateway;
    userGateway: ModelGateway;
    k?: number;
    only?: string[];
    pick?: (store: string, scenario: string) => boolean;
    log?: (s: string) => void;
    /** tests skip the quiet window with a clock ahead of the database */
    clock?: Clock;
    /** a throttled free tier needs longer than the in-product minute per answer */
    turnWaitMs?: number;
  },
): Promise<SuiteResult> {
  const k = o.k ?? 3;
  configureVendedor({ sql, sessionSecret: 'sims', storeDomain: 'vendua.test' });
  const runtime = new Runtime<Sql>({
    agents: [vendedor],
    store: new PgActorStore(sql),
    gateway: o.agentGateway,
    transports: [vendedorTransport],
    owner: `sims-${process.pid}`,
    memory: pgMemory,
    hooks: hostHooks(),
    ...(o.clock ? { clock: o.clock } : {}),
  });
  let stop = false;
  // the worker a Core process would run: ingest, then due actors, until the suite ends
  const loop = (async () => {
    while (!stop) {
      const ingested = await ingestPass({ sql, media: null, gateway: null }).catch(() => 0);
      const ran = await runtime.pump('interactive', { limit: 8, perTenantCap: 8 }).catch(() => 0);
      if (!ingested && !ran) await new Promise((r) => setTimeout(r, 300));
    }
  })();

  const fixtures: StoreFixture[] = o.only?.length
    ? FIXTURES.filter((f) => o.only!.includes(f.key))
    : FIXTURES;
  const scenarios: SuiteResult['scenarios'] = [];
  try {
    for (const f of fixtures) {
      const tenantId = await createFixtureStore(sql, f);
      for (const [i, sc] of f.scenarios.entries()) {
        if (o.pick && !o.pick(f.key, sc.name)) continue;
        const runs: ScenarioResult[] = [];
        for (let r = 0; r < k; r++) {
          const res = await runScenario(
            sql,
            o.userGateway,
            tenantId,
            `sim-${Date.now().toString(36)}`,
            i * 100 + r,
            {
              ...sc,
              check: sc.expect === 'handoff' ? 'chamou a loja' : 'pedido certo',
            },
            o.turnWaitMs ? { turnWaitMs: o.turnWaitMs } : {},
          );
          runs.push(res);
          o.log?.(
            `${f.key} · ${sc.name} · run ${r + 1}/${k}: ${res.passed ? 'ok' : `FALHOU (${res.why})`}`,
          );
        }
        scenarios.push({ store: f.key, name: sc.name, runs, passed: runs.every((x) => x.passed) });
      }
    }
  } finally {
    stop = true;
    await loop;
  }
  const allRuns = scenarios.flatMap((s) => s.runs);
  return {
    k,
    scenarios,
    accuracy: allRuns.length ? allRuns.filter((r) => r.passed).length / allRuns.length : 0,
    passedAll: scenarios.every((s) => s.passed),
  };
}
