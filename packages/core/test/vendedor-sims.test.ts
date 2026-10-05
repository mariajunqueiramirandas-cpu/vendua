import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createGateway, type Json, type ScriptedOutput } from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { migrate, type Sql } from '../src/platform/db.ts';
import { clienteOcultoPass, score } from '../src/vendedor/cliente-oculto.ts';
import { createFixtureStore, FIXTURES } from '../src/vendedor/sims/fixtures.ts';
import { runSuite } from '../src/vendedor/sims/run.ts';

// The order-accuracy harness itself, with both sides scripted: the fixture store, the
// simulated shopper, the real ingest/runtime/tools, the test order and the code score.

const OWNER_URL = process.env.TEST_DATABASE_URL;

const gw = (script: ScriptedOutput[] | ((req: unknown, i: number) => ScriptedOutput)) =>
  createGateway({
    adapters: [scriptedAdapter(script)],
    routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
  });
const call = (name: string, args: Record<string, Json> = {}) => ({ name, args });

describe('scoring is code', () => {
  const sc = FIXTURES[0]!.scenarios[0]!;
  const target = sc.target!;
  test('the same lines, mode and payment pass; anything else says why', () => {
    const order = {
      lines: target.lines.map((l) => ({
        name: l.name,
        qty: l.qty,
        options: [...l.options].reverse(),
      })),
      checkout: { delivery: { mode: target.mode }, payment: { method: target.payment } },
    };
    expect(score({ ...sc, check: '' }, order, false).passed).toBe(true);
    expect(
      score(
        { ...sc, check: '' },
        { ...order, checkout: { delivery: { mode: 'pickup' }, payment: { method: 'pix' } } },
        false,
      ).why,
    ).toContain('esperava delivery');
    expect(score({ ...sc, check: '' }, null, false).passed).toBe(false);
  });

  test('a degrade line from a model outage is skipped, not scored as a handoff', () => {
    expect(score({ ...sc, check: '' }, null, true, true)).toMatchObject({
      passed: false,
      skipped: true,
    });
    expect(score({ ...sc, check: '' }, null, true).why).toBe('passou para a loja em vez de fechar');
    const handoff = { ...sc, expect: 'handoff' as const, target: null, check: '' };
    expect(score(handoff, null, true, true).skipped).toBe(true);
    expect(score(handoff, null, true).passed).toBe(true);
    // the order closed right before the outage still counts
    const order = {
      lines: target.lines.map((l) => ({ name: l.name, qty: l.qty, options: l.options })),
      checkout: { delivery: { mode: target.mode }, payment: { method: target.payment } },
    };
    expect(score({ ...sc, check: '' }, order, true, true)).toEqual({
      passed: true,
      why: 'pedido igual ao escondido',
    });
  });
});

describe.skipIf(!OWNER_URL)('the suite on Postgres (scripted)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} }) as unknown as Sql;
  afterAll(async () => {
    await sql`delete from tenants where slug like 'sim-pizzaria-%' and created_at > now() - interval '1 hour'`;
    await sql.end();
  });

  test('a pizzaria scenario: halves, borda, a coca, delivery, Pix — scored right', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const agent = gw([
      { toolCalls: [call('get_product', { product: 'pizza-g' })] },
      {
        toolCalls: [
          call('cart_edit', {
            ops: [
              {
                op: 'add',
                product: 'pizza-g',
                options: [{ id: 'm1' }, { id: 'm3' }, { id: 'm6' }],
              },
              { op: 'add', product: 'coca-2l' },
            ],
          }),
          call('set_fulfillment', {
            mode: 'delivery',
            street: 'Rua A',
            number: '10',
            neighborhood: 'Centro',
          }),
          call('set_payment', { method: 'pix' }),
          call('set_customer', { name: 'Júlia' }),
        ],
      },
      { toolCalls: [call('send_summary')] },
      { toolCalls: [call('reply', { text: 'Confere o resumo? Posso confirmar?' })] },
      { toolCalls: [call('place_order')] },
      { toolCalls: [call('reply', { text: 'Pedido de teste feito!' })] },
    ]);
    const shopper = gw([
      {
        text: 'quero uma G meia calabresa meia frango com catupiry, borda de catupiry, e uma coca 2L. entrega na Rua A, 10, Centro, pix, Júlia',
      },
      { text: 'sim' },
      { text: 'FIM' },
    ]);
    const result = await runSuite(sql, {
      agentGateway: agent,
      userGateway: shopper,
      k: 1,
      only: ['pizzaria'],
      pick: (_s, name) => name.startsWith('meia calabresa'),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]!.runs[0]!.why).toBe('pedido igual ao escondido');
    expect(result.passedAll).toBe(true);
  }, 60_000);

  // the pass takes the oldest queued run in the database: play until ours is done
  const play = async (tenantId: string, gateway: ReturnType<typeof gw>) => {
    const [r] = await sql<{ id: string }[]>`
      insert into vendedor_runs (tenant_id, trigger) values (${tenantId}, 'manual') returning id`;
    for (let i = 0; i < 50; i++) {
      const [row] = await sql<
        { status: string }[]
      >`select status from vendedor_runs where id = ${r!.id}`;
      if (row!.status === 'done' || row!.status === 'failed') break;
      await clienteOcultoPass(sql, gateway);
    }
    const [run] = await sql<
      {
        status: string;
        total: number;
        error: string | null;
        results: { name: string; skipped?: boolean; threadId: string | null }[];
      }[]
    >`select status, total, error, results from vendedor_runs where id = ${r!.id}`;
    return run!;
  };

  test('Cliente oculto plays every shopper at once and saves them all in menu order', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const tenantId = await createFixtureStore(
      sql,
      FIXTURES.find((f) => f.key === 'pizzaria')!,
    );
    // every shopper leaves at once: each scenario's thread exists, none is skipped
    const run = await play(
      tenantId,
      gw((_req, _i) => ({ text: 'FIM', delayMs: 50 })),
    );
    expect(run.status).toBe('done');
    expect(run.total).toBeGreaterThan(1);
    expect(run.results).toHaveLength(run.total);
    expect(run.results.every((r) => !r.skipped && r.threadId)).toBe(true);
    const threads = await sql<{ address: string }[]>`
      select address from shopper_threads where tenant_id = ${tenantId} and test_kind = 'cliente_oculto'`;
    expect(threads).toHaveLength(run.total);
  }, 60_000);

  test('a model that refuses every shopper fails the run with its error', async () => {
    const tenantId = await createFixtureStore(
      sql,
      FIXTURES.find((f) => f.key === 'pizzaria')!,
    );
    const run = await play(
      tenantId,
      gw(() => ({ error: { status: 400, message: 'bad request' } })),
    );
    expect(run.status).toBe('failed');
    expect(run.error).toContain('bad request');
    expect(run.results.every((r) => r.skipped)).toBe(true);
  }, 60_000);
});
