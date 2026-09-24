import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createSql, migrate } from '../platform/db.ts';
import { upsertIntegration, DEFAULT_SECRET } from '../modules/integrations.ts';
import { runSim } from './sim.ts';
import { SIM_SCENARIOS, getScenario } from './sim-scenarios.ts';
import { log } from '../platform/log.ts';

/**
 * agent/sim-cli — `bun run sim` — drives the negotiation simulator.
 *
 *   bun run sim -- --all                      every scenario
 *   bun run sim -- --scenario padaria-cetica  one scenario
 *   bun run sim -- --list                     names only
 *   --driver gemini|openrouter|anthropic|openai  (default gemini)
 *   --model <id>                               provider model override
 *   --harness slimToolOutputs,staticSystem     opt into harness flags
 *                                              (integration.config.harness)
 *
 * Runs against an isolated `vendua_sim` database (created + migrated on the
 * same docker postgres): the `whatsapp`/`email` drivers are `log` (messages
 * record 'sent' without leaving the building), `llm` is gemini, and guardrails
 * are loosened so the sim can actually talk (no quiet hours, no first-contact
 * draft gate, high daily cap). Needs GEMINI_API_KEY in env.
 *
 * Each run writes sim-results/<scenario>-<ts>.json (transcript + judge) and a
 * sim_runs row.
 */

const BASE_URL =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const SIM_URL = process.env.SIM_DATABASE_URL ?? BASE_URL.replace(/\/[^/]+$/, '/vendua_sim');

const cliLog = log.child({ mod: 'sim-cli' });

async function ensureSimDb() {
  // Honor SIM_DATABASE_URL's server AND target db: admin connects to that
  // server's maintenance db ('postgres'), not BASE_URL's — a custom SIM_URL
  // elsewhere would otherwise create the db on the wrong host. The name is
  // interpolated into raw SQL, so restrict it to a bare identifier.
  const dbName = SIM_URL.replace(/\?.*$/, '').split('/').pop() ?? 'vendua_sim';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error(`SIM_DATABASE_URL has an invalid database name: '${dbName}'`);
  }
  const adminUrl = new URL(SIM_URL);
  adminUrl.pathname = adminUrl.pathname.replace(/\/[^/]+$/, '/postgres');
  const admin = createSql(adminUrl.toString());
  try {
    await admin.unsafe(`create database ${dbName}`);
    cliLog.info({ db: dbName }, 'sim database created');
  } catch (e) {
    if (!String(e).includes('already exists')) throw e;
  } finally {
    await admin.end();
  }
}

async function seedSimEnv(
  sql: ReturnType<typeof createSql>,
  llm: { driver: string; model?: string | undefined; harness?: Record<string, boolean> },
) {
  const opts = [
    await upsertIntegration(
      sql,
      {
        kind: 'llm',
        driver: llm.driver,
        enabled: true,
        config: {
          ...(llm.model ? { model: llm.model } : {}),
          ...(llm.harness && Object.keys(llm.harness).length
            ? { harness: llm.harness }
            : {}),
        },
      },
      `sim:llm:${llm.driver}:${llm.model ?? 'default'}:${process.pid}`,
    ),
    await upsertIntegration(sql, { kind: 'whatsapp', driver: 'log', enabled: true }, 'sim:wa'),
    await upsertIntegration(sql, { kind: 'email', driver: 'log', enabled: true }, 'sim:email'),
  ];
  for (const o of opts)
    if (o.status !== 200) throw new Error(`integration seed failed: ${JSON.stringify(o)}`);
  await sql`
    insert into control_settings (key, value) values ('guardrails', ${sql.json({
      maxOutboundPerLeadPerDay: 50,
      quietStart: '00:00',
      quietEnd: '00:00',
      timezone: 'America/Sao_Paulo',
      firstContactDraftOnly: false,
      discoveryAutoContact: false,
      discoveryContactMinScore: 8,
      inboundReplyDelayMin: 0,
      firstContactDelayMin: 0,
    })})
    on conflict (key) do update set value = excluded.value`;
  await sql`
    insert into control_settings (key, value) values ('meeting', ${sql.json({
      bookingUrl: 'https://sim.invalid/agendar',
    })})
    on conflict (key) do update set value = excluded.value`;
  // The quotable offer — without it the prompt forbids citing any price/link.
  await sql`
    insert into control_settings (key, value) values ('pitch', ${sql.json({
      offer:
        'plano Venduá: R$149/mês, sem comissão por pedido; 7 dias de teste grátis; cadastro: https://sim.invalid/cadastro; loja exemplo: https://sim.invalid/loja-exemplo',
    })})
    on conflict (key) do update set value = excluded.value`;
}

const args = process.argv.slice(2);
const list = args.includes('--list');
const all = args.includes('--all');
const names = args.flatMap((a, i) => (a === '--scenario' && args[i + 1] ? [args[i + 1]!] : []));

const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const llmDriver = flag('--driver') ?? 'gemini';
const llmModel = flag('--model');
// --harness slimToolOutputs,staticSystem — flips the runner flags through
// the same config.harness key the real integration row reads.
const harnessFlags = Object.fromEntries(
  (flag('--harness') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => [f, true]),
);
if (list) {
  for (const s of SIM_SCENARIOS) cliLog.info(`${s.name} — ${s.description}`);
  process.exit(0);
}

const driverKey = DEFAULT_SECRET[llmDriver];
if (driverKey && !process.env[driverKey]) {
  cliLog.error(
    `${driverKey} is required for --driver ${llmDriver} — the sim plays both sides live.`,
  );
  process.exit(1);
}

const wanted = all
  ? SIM_SCENARIOS
  : names.map((n) => {
      const s = getScenario(n);
      if (!s) throw new Error(`unknown scenario '${n}' — try --list`);
      return s;
    });
if (!wanted.length) {
  cliLog.error(
    `usage: bun run sim -- --all | --scenario <name>\navailable: ${SIM_SCENARIOS.map((s) => s.name).join(', ')}`,
  );
  process.exit(1);
}

await ensureSimDb();
const sql = createSql(SIM_URL);
await migrate(sql, join(import.meta.dir, '../../db/migrations'));
await seedSimEnv(sql, { driver: llmDriver, model: llmModel, harness: harnessFlags });

await mkdir(join(import.meta.dir, '../../sim-results'), { recursive: true });

for (const scenario of wanted) {
  cliLog.info(`\n=== ${scenario.name} — ${scenario.description}`);
  try {
    const result = await runSim(sql, scenario);
    const file = join(
      import.meta.dir,
      '../../sim-results',
      `${scenario.name}-${new Date().toISOString().replaceAll(':', '-')}.json`,
    );
    await writeFile(file, JSON.stringify(result, null, 2));
    cliLog.info(`outcome=${result.outcome} score=${result.score} turns=${result.turns}`);
    cliLog.info(`judge: ${JSON.stringify(result.judge, null, 0).slice(0, 400)}`);
    cliLog.info(`saved ${file}`);
  } catch (e) {
    cliLog.error(`FAILED ${scenario.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

await sql.end();
