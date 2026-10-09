import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  type Json,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { vendedor } from '../src/agent-host/agents/vendedor/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { claimForTurnTx, WEB_CHAT_NEW_PER_HOUR } from '../src/vendedor/allowance.ts';
import { configureVendedor } from '../src/vendedor/deps.ts';
import { ingestPass } from '../src/vendedor/ingest.ts';
import { loadThread } from '../src/vendedor/threads.ts';
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
      // no transcription route here: photos only
      media: { voice: false, image: true },
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

  test('scripted carts cannot spend the month: new site conversations are capped per hour', async () => {
    const webThread = async (tag: string) => {
      const [c] = await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenantId}, ${`${tag}-${crypto.randomUUID()}`}) returning id`;
      const [t] = await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address, cart_id, class)
        values (${tenantId}, 'web', ${`web:${c!.id}`}, ${c!.id}, 'shopper') returning id`;
      return { id: t!.id, tag };
    };
    const claim = (threadId: string) =>
      withTenant(appSql, tenantId, async (tx) => {
        const t = (await loadThread(tx, tenantId, threadId, { forUpdate: true }))!;
        return claimForTurnTx(tx, t, 'agent', { key: `cap:${threadId}`, silenceMin: 30 });
      });
    const counted = () =>
      sql`select 1 from ai_conversations a join shopper_threads t on a.subject_key = 'thread:' || t.id::text
        where a.tenant_id = ${tenantId} and t.channel = 'web' and a.started_at > now() - interval '1 hour'`;
    while ((await counted()).length < WEB_CHAT_NEW_PER_HOUR) {
      const t = await webThread('script');
      expect(await claim(t.id)).toBe(true);
    }
    const over = await webThread('over');
    expect(await claim(over.id)).toBe(false);
    expect(await counted()).toHaveLength(WEB_CHAT_NEW_PER_HOUR);
    const [msg] = await sql<{ author: string; body: string }[]>`
      select author, body from shopper_messages where thread_id = ${over.id}`;
    expect(msg).toMatchObject({ author: 'core', body: expect.stringContaining('cardápio') });
    // a conversation already counted keeps going
    const [first] = await sql<{ id: string }[]>`
      select t.id from shopper_threads t join ai_conversations a on a.subject_key = 'thread:' || t.id::text
      where t.tenant_id = ${tenantId} and t.channel = 'web' limit 1`;
    expect(await claim(first!.id)).toBe(true);
  });

  test('a voice message and a photo are stored as WhatsApp’s are, and heard on the ingest', async () => {
    await sql`update store_agent set settings = settings || '{"webChat": true}'::jsonb where tenant_id = ${tenantId}`;
    const session = (await call('POST', '/checkout/v1/session', {})).body.sessionToken as string;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');
    const voice = {
      kind: 'voice',
      mime: 'audio/webm;codecs=opus',
      data: btoa('OggS fake'),
      seconds: 2,
    };
    // this Core has no transcription: the page offers photos only, and a voice message is refused
    expect((await call('GET', '/checkout/v1/chat', undefined, session)).body.media).toEqual({
      voice: false,
      image: true,
    });
    expect((await call('POST', '/checkout/v1/chat', voice, session)).status).toBe(415);

    const media = {
      transcribe: async () => ({ text: 'tem coca de 2 litros?', confidence: 0.9, language: 'pt' }),
      speak: async () => null,
      canTranscribe: async () => true,
    };
    const hearing = createApp({
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      cepLookup: async () => null,
      storeDomain: 'vendua.test',
      duaMedia: { media, gateway: null },
    });
    const post = async (body: unknown) => {
      const res = await hearing.request(`http://${host}/checkout/v1/chat`, {
        method: 'POST',
        headers: {
          host,
          'content-type': 'application/json',
          authorization: `Bearer ${session}`,
          'idempotency-key': `${nonce}-${++idem}`,
        },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any };
    };
    const v = await post(voice);
    expect(v.status).toBe(201);
    expect(v.body.media).toEqual({ voice: true, image: true });
    expect(v.body.messages.at(-1)).toMatchObject({ kind: 'voice', body: '', author: 'shopper' });
    const p = await post({ kind: 'image', mime: 'image/png', data: png, text: 'tem dessa?' });
    expect(p.status).toBe(201);
    expect(p.body.messages.at(-1)).toMatchObject({ kind: 'image', body: 'tem dessa?' });
    expect((await post({ kind: 'image', mime: 'image/jpeg', data: png })).status).toBe(415);
    const rows = await sql<{ kind: string; mime: string; n: number }[]>`
      select m.kind, d.mime, octet_length(d.bytes)::int as n from shopper_messages m
      join shopper_media d on d.message_id = m.id join shopper_threads t on t.id = m.thread_id
      where t.tenant_id = ${tenantId} and t.channel = 'web' order by m.created_at`;
    expect(rows.map((r) => [r.kind, r.mime])).toEqual([
      ['audio', 'audio/webm;codecs=opus'],
      ['image', 'image/png'],
    ]);

    const gateway = {
      generate: async () => ({
        text: JSON.stringify({
          description: 'Uma garrafa de refrigerante',
          food: true,
          receipt: false,
        }),
      }),
    } as unknown as ModelGateway;
    for (let i = 0; i < 5; i++) if (!(await ingestPass({ sql: appSql, media, gateway }))) break;
    const chat = await call('GET', '/checkout/v1/chat', undefined, session);
    expect(chat.body.messages.filter((m: { author: string }) => m.author === 'shopper')).toEqual([
      expect.objectContaining({ kind: 'voice', body: 'tem coca de 2 litros?' }),
      expect.objectContaining({ kind: 'image', body: 'tem dessa?' }),
    ]);
    const [photo] = await sql<{ meta: { description?: string } }[]>`
      select m.meta from shopper_messages m join shopper_threads t on t.id = m.thread_id
      where t.tenant_id = ${tenantId} and t.channel = 'web' and m.kind = 'image'`;
    expect(photo!.meta.description).toBe('Uma garrafa de refrigerante');
  });
});
