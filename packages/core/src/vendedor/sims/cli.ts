import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simGateways } from '../../agent-host/sim-gateways.ts';
import { createSql, migrate } from '../../platform/db.ts';
import { runSuite } from './run.ts';

// `bun run sims:vendedor` — the Vendedor's order-accuracy suite on live models (paid). Every
// prompt, tool or model change runs it; the gate is accuracy ≥ 98% and every scenario passing
// on all k runs (sales-agent.md §8 V2 exit gate, a proposal).
//
//   SIM_DATABASE_URL (default: TEST_DATABASE_URL)  — a migrated database; stores are created fresh
//   models: see agent-host/sim-gateways.ts (AGENT_MODEL_ROUTES, SIM_USER_ROUTES, keys, SIM_RPM)
//   bun run sims:vendedor -- [--k 3] [--only pizzaria,acai] [--pick "meia calabresa"]

const url = process.env.SIM_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) throw new Error('set SIM_DATABASE_URL or TEST_DATABASE_URL');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const gateways = simGateways();
if (!gateways) {
  console.error('no provider keys in env: the suite needs a live model');
  process.exit(2);
}
const { agentGateway, userGateway } = gateways;

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
