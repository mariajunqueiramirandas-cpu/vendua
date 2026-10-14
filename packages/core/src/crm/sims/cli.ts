import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simGateways } from '../../agent-host/sim-gateways.ts';
import { upsertIntegration } from '../../modules/integrations.ts';
import { createSql, migrate, type Sql } from '../../platform/db.ts';
import { runSim } from './run.ts';
import { getScenario, SIM_SCENARIOS } from './scenarios.ts';

// `bun run sims:crm` — the lead agent's negotiation sims on live models (paid), on an isolated
// `vendua_sim` database: the run rewrites the workspace's pitch, guardrails and agent settings.
// Writes sim-results/<scenario>-<ts>.json and a sim_runs row.
//
//   bun run sims:crm -- --all | --scenario <name> | --list
//   SIM_DATABASE_URL (default: MIGRATION_DATABASE_URL's server, database vendua_sim)
//   models: see agent-host/sim-gateways.ts (AGENT_MODEL_ROUTES, SIM_USER_ROUTES, keys, SIM_RPM)

const BASE_URL =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const SIM_URL = process.env.SIM_DATABASE_URL ?? BASE_URL.replace(/\/[^/]+$/, '/vendua_sim');

async function ensureSimDb() {
  // the name is interpolated into raw SQL: a bare identifier only
  const dbName = SIM_URL.replace(/\?.*$/, '').split('/').pop() ?? 'vendua_sim';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName))
    throw new Error(`SIM_DATABASE_URL has an invalid database name: '${dbName}'`);
  const adminUrl = new URL(SIM_URL);
  adminUrl.pathname = adminUrl.pathname.replace(/\/[^/]+$/, '/postgres');
  const admin = createSql(adminUrl.toString());
  try {
    await admin.unsafe(`create database ${dbName}`);
  } catch (e) {
    if (!String(e).includes('already exists')) throw e;
  } finally {
    await admin.end();
  }
}

async function seedSimEnv(sql: Sql) {
  for (const kind of ['whatsapp', 'email'] as const) {
    const r = await upsertIntegration(sql, { kind, driver: 'log', enabled: true }, `sim:${kind}`);
    if (r.status !== 200) throw new Error(`integration seed failed: ${JSON.stringify(r)}`);
  }
  const put = (key: string, value: unknown) => sql`
    insert into control_settings (key, value) values (${key}, ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value`;
  await put('guardrails', {
    maxOutboundPerLeadPerDay: 50,
    quietHoursEnabled: false,
    timezone: 'America/Sao_Paulo',
    discoveryAutoContact: false,
    discoveryContactMinScore: 8,
    inboundReplyDelayMin: 0,
    firstContactDelayMin: 0,
  });
  // autopilot: a first contact sends instead of drafting, so scenarios reach the wire
  await put('agent', { level: 'autopilot' });
  await put('meeting', { bookingUrl: 'https://sim.invalid/agendar' });
  // the quotable offer: without it the prompt forbids citing any price or link
  await put('pitch', {
    offer:
      'plano Venduá: R$149/mês, sem comissão por pedido; 7 dias de teste grátis; cadastro: https://sim.invalid/cadastro; loja exemplo: https://sim.invalid/loja-exemplo',
  });
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of SIM_SCENARIOS) console.log(`${s.name} — ${s.description}`);
  process.exit(0);
}
const names = args.flatMap((a, i) => (a === '--scenario' && args[i + 1] ? [args[i + 1]!] : []));
const wanted = args.includes('--all')
  ? SIM_SCENARIOS
  : names.map((n) => {
      const s = getScenario(n);
      if (!s) throw new Error(`unknown scenario '${n}' — try --list`);
      return s;
    });
if (!wanted.length) {
  console.error(
    `usage: bun run sims:crm -- --all | --scenario <name>\navailable: ${SIM_SCENARIOS.map((s) => s.name).join(', ')}`,
  );
  process.exit(1);
}
const gateways = simGateways();
if (!gateways) {
  console.error('no provider keys in env: the sim plays both sides live');
  process.exit(2);
}

await ensureSimDb();
const sql = createSql(SIM_URL);
await migrate(sql, join(import.meta.dir, '../../../db/migrations'));
await seedSimEnv(sql);
const dir = join(import.meta.dir, '../../../sim-results');
await mkdir(dir, { recursive: true });

let failed = 0;
for (const scenario of wanted) {
  console.log(`\n=== ${scenario.name} — ${scenario.description}`);
  try {
    const result = await runSim(sql, scenario, gateways);
    const file = join(
      dir,
      `${scenario.name}-${new Date().toISOString().replaceAll(':', '-')}.json`,
    );
    await writeFile(file, JSON.stringify(result, null, 2));
    console.log(`outcome=${result.outcome} score=${result.score} turns=${result.turns}`);
    console.log(`judge: ${JSON.stringify(result.judge).slice(0, 400)}`);
    console.log(`saved ${file}`);
  } catch (e) {
    failed++;
    console.error(`FAILED ${scenario.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
await sql.end();
process.exit(failed ? 1 : 0);
