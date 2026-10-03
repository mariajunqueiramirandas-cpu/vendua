import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createGateway, Runtime, type Json, type ScriptedOutput } from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { vendedor } from '../src/agent-host/agents/vendedor/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { configureVendedor } from '../src/vendedor/deps.ts';
import { ingestPass } from '../src/vendedor/ingest.ts';
import { vendedorTransport } from '../src/vendedor/transport.ts';

// The storefront chat (ADR 0031 V4): the Vendedor on the store's site, editing the page's own cart.

describe.skipIf(!process.env.TEST_DATABASE_URL)('the storefront chat (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = (process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql) as unknown as Sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  const host = `web-${nonce}.localhost`;
  let idem = 0;
  let tenantId = '';
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const [t] = await sql<
      { id: string }[]
    >`insert into tenants (slug, name) values (${`web-${nonce}`}, 'Forno da Vila') returning id`;
    tenantId = t!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`insert into store_settings ${sql({
      tenant_id: tenantId,
      hours: sql.json({
        timezone: 'America/Sao_Paulo',
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
      }),
      prep_time_minutes: 30,
      min_order_cents: 0,
      currency: 'BRL',
      vocabulary: sql.json({}),
    })}`;
    const [c] = await sql<
      { id: string }[]
    >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'bebidas', 'Bebidas') returning id`;
    await sql`insert into products (tenant_id, category_id, slug, name, base_price_cents) values (${tenantId}, ${c!.id}, 'coca-2l', 'Coca-Cola 2 L', 1400)`;
    await sql`insert into store_agent (tenant_id, enabled, settings) values (${tenantId}, true, ${sql.json({ coverage: 'when_slow' })})`;
    configureVendedor({ sql: appSql, sessionSecret: 's', storeDomain: 'vendua.test' });
  });
  afterAll(async () => {
    await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
    if ((appSql as unknown) !== sql)
      await (appSql as unknown as { end: () => Promise<void> }).end();
  });

  test('off until the merchant turns it on; then it answers at once and fills the page cart', async () => {
    expect((await call('GET', '/storefront/v1/store')).body.chat).toBeNull();
    const session = (await call('POST', '/checkout/v1/session', {})).body.sessionToken as string;
    expect((await call('POST', '/checkout/v1/chat', { text: 'oi' }, session)).status).toBe(404);
    await sql`update store_agent set settings = settings || '{"webChat": true}'::jsonb where tenant_id = ${tenantId}`;
    expect((await call('GET', '/storefront/v1/store')).body.chat).toMatchObject({
      name: 'Duá',
      intro: expect.stringMatching(/^o Duá, assistente virtual da /),
    });
    expect((await call('POST', '/checkout/v1/chat', { text: 'oi' })).status).toBe(401);
    expect((await call('POST', '/checkout/v1/chat', { text: '' }, session)).status).toBe(422);
    const sent = await call(
      'POST',
      '/checkout/v1/chat',
      { text: 'quero uma coca 2 litros' },
      session,
    );
    expect(sent.status).toBe(201);
    expect(sent.body.pending).toBe(true);

    const call2 = (name: string, args: Record<string, Json> = {}) => ({ name, args });
    const script: ScriptedOutput[] = [
      { toolCalls: [call2('cart_edit', { ops: [{ op: 'add', product: 'coca-2l' }] })] },
      { toolCalls: [call2('send_link')] },
      {
        toolCalls: [
          call2('reply', { text: 'Coloquei a {{l1.item}} na sua sacola, é só finalizar.' }),
        ],
      },
    ];
    const rt = new Runtime<Sql>({
      agents: [vendedor],
      store: new PgActorStore(appSql),
      gateway: createGateway({
        adapters: [scriptedAdapter(script)],
        routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
      }),
      transports: [vendedorTransport],
      owner: 'web-test',
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
    await ingestPass({ sql: appSql, media: null, gateway: null });
    for (let i = 0; i < 10; i++) {
      await sql`update agent_actors set next_wake_at = null where tenant_id <> ${tenantId} and agent_id = 'vendedor'`;
      if ((await rt.pump('interactive', { limit: 5, perTenantCap: 5 })) === 0) break;
    }
    const cart = await call('GET', '/checkout/v1/cart', undefined, session);
    expect(cart.body.cart?.items ?? cart.body.items).toHaveLength(1);
    const chat = await call('GET', '/checkout/v1/chat', undefined, session);
    expect(chat.body.messages.map((m: { author: string; body: string }) => m.body)).toEqual([
      'quero uma coca 2 litros',
      'Coloquei a 1× Coca-Cola 2 L na sua sacola, é só finalizar.',
      expect.stringContaining('/sacola'),
    ]);
    expect(await sql`select 1 from store_wa_messages where tenant_id = ${tenantId}`).toHaveLength(
      0,
    );
  });
});
