import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createGateway, type ScriptedOutput } from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { migrate, type Sql } from '../src/platform/db.ts';
import { score } from '../src/vendedor/cliente-oculto.ts';
import { FIXTURES } from '../src/vendedor/sims/fixtures.ts';
import { runSuite } from '../src/vendedor/sims/run.ts';

// The order-accuracy harness itself, with both sides scripted: the fixture store, the
// simulated shopper, the real ingest/runtime/tools, the test order and the code score.

const OWNER_URL = process.env.TEST_DATABASE_URL;

const gw = (script: ScriptedOutput[]) =>
  createGateway({
    adapters: [scriptedAdapter(script)],
    routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
  });
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });

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
});
