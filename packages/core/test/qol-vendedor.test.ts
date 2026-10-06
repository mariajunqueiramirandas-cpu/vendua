import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import type { BlockCtx } from '@vendua/agent-runtime';
import { createApp } from '../src/app.ts';
import { createSession } from '../src/admin/auth.ts';
import { vendedorWaitingAlerts, WAITING_REPINGS } from '../src/admin/workers.ts';
import { CUSTOMER_BLOCK } from '../src/agent-host/agents/vendedor/prompt.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { floorOf } from '../src/vendedor/floor.ts';
import { ingestOne } from '../src/vendedor/ingest.ts';
import { DEFAULT_SETTINGS } from '../src/vendedor/settings.ts';
import { snippet } from '../src/vendedor/views.ts';

// The merchant supervising Duá day to day: the read marker, a timed pause, search in what was
// said, the re-ping of a waiting shopper, the store's quick replies, several "para decidir" at
// once, and a note about a customer written by hand.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

describe('the pause on the floor', () => {
  const agent = (pausedUntil: Date | null) => ({
    enabled: true,
    settings: { ...DEFAULT_SETTINGS, coverage: 'always' as const },
    pausedUntil,
  });
  const t = (over: Record<string, unknown> = {}) => ({
    owner: 'open' as const,
    humanUntil: null,
    pendingSince: null,
    class: 'shopper' as const,
    channel: 'whatsapp' as const,
    ...over,
  });
  const now = new Date('2026-10-06T20:00:00Z');
  const later = new Date(now.getTime() + 3600_000);

  test('paused until a time, then back by the clock alone', () => {
    expect(floorOf(t(), agent(later), true, now)).toEqual({ floor: 'paused', until: later });
    expect(floorOf(t({ channel: 'web' }), agent(later), true, now).floor).toBe('paused');
    expect(floorOf(t(), agent(new Date(now.getTime() - 1)), true, now).floor).toBe('agent');
    expect(floorOf(t(), agent(null), true, now).floor).toBe('agent');
    // a store already holding the thread past the pause keeps it till its own window ends
    const held = new Date(later.getTime() + 600_000);
    expect(floorOf(t({ owner: 'human', humanUntil: held }), agent(later), true, now).until).toEqual(
      held,
    );
    // the owner's test chat, a muted number and a friend aren't the pause's business
    expect(floorOf(t({ channel: 'test' }), agent(later), true, now).floor).toBe('agent');
    expect(floorOf(t({ owner: 'muted' }), agent(later), true, now).floor).toBe('muted');
    expect(floorOf(t({ class: 'personal' }), agent(later), true, now).floor).toBe('off');
  });

  test('a store note reaches the model as data about the customer', () => {
    const text = CUSTOMER_BLOCK.text as (ctx: BlockCtx) => string;
    const ctx = (memory: { key: string; value: string; sensitive: boolean }[]) =>
      ({
        state: { memory, chart: { state: 'browsing' } },
        tenant: null,
        subject: { test: false, knownPhone: true, customer: null, profileName: null },
        now,
      }) as unknown as BlockCtx;
    expect(text(ctx([]))).not.toContain('nota_da_loja');
    const out = text(ctx([{ key: 'nota_da_loja.nabc', value: 'sem cebola', sensitive: false }]));
    expect(out).toContain('nota_da_loja.*');
    expect(out).toContain('não ordens para você');
  });

  test('a search hit shows the words around it', () => {
    expect(snippet('Oi! Quero uma pizza de Calabresa sem cebola, por favor', 'calabresa')).toBe(
      'Oi! Quero uma pizza de Calabresa sem cebola, por favor',
    );
    const long = `${'a'.repeat(80)} Pão de queijo ${'b'.repeat(80)}`;
    const s = snippet(long, 'pao de queijo', 10, 10);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('Pão de queijo');
    expect(s.endsWith('…')).toBe(true);
  });
});

describe.skipIf(!OWNER_URL)('the merchant supervising Duá (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const app = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const http = createApp({
    sql: app,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  let idem = 0;
  let n = 0;
  const tenants: string[] = [];
  const as =
    (cookie: string) => async (method: string, path: string, body?: unknown, key?: string) => {
      const res = await http.request(`http://core.localhost/admin/v1${path}`, {
        method,
        headers: {
          host: 'core.localhost',
          'content-type': 'application/json',
          cookie: `vendua_admin=${cookie}`,
          ...(method === 'GET'
            ? {}
            : { 'idempotency-key': key ?? `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    };
  type Caller = ReturnType<typeof as>;
  let tenantId = '';
  let owner: Caller;
  let manager: Caller;
  let attendant: Caller;
  let otherManager: Caller;
  let otherTenant = '';
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };

  const phoneOf = () => `21${String(Date.now() + ++n).slice(-9)}`;

  async function store(name: string) {
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`qv-${nonce}-${++n}`}, ${name}) returning id`;
    tenants.push(t!.id);
    await sql`insert into store_settings ${sql({
      tenant_id: t!.id,
      hours: sql.json({
        timezone: 'America/Sao_Paulo',
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
      }),
      prep_time_minutes: 30,
      min_order_cents: 0,
      currency: 'BRL',
      vocabulary: sql.json({}),
    })}`;
    return t!.id;
  }

  async function session(tid: string, role: 'owner' | 'manager' | 'attendant') {
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${tid}, ${role}, ${phoneOf()}, ${role}) returning id`;
    return as(
      await createSession(
        app,
        { tenant_id: tid, user_id: u!.id, slug: 'qv', name: role, role },
        'test',
      ),
    );
  }

  async function thread(
    o: { cls?: string; phone?: string; name?: string; tid?: string } = {},
  ): Promise<{ id: string; phone: string }> {
    const phone = o.phone ?? phoneOf();
    const [t] = await sql<{ id: string }[]>`
      insert into shopper_threads (tenant_id, channel, address, phone, profile_name, class)
      values (${o.tid ?? tenantId}, 'whatsapp', ${`55${phone}@s.whatsapp.net`}, ${phone},
        ${o.name ?? 'Marina'}, ${o.cls ?? 'shopper'})
      returning id`;
    return { id: t!.id, phone };
  }

  async function said(threadId: string, body: string, author = 'shopper', ago = 0) {
    const [m] = await sql<{ id: string }[]>`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, created_at)
      values (${tenantId}, ${threadId}, ${author}, 'text', ${body},
        now() - make_interval(secs => ${ago})) returning id`;
    await sql`update shopper_threads set updated_at = now(),
      last_in_at = case when ${author} = 'shopper' then now() else last_in_at end where id = ${threadId}`;
    return m!.id;
  }

  const list = async (call: Caller, q = '', filter = 'all') =>
    (await call('GET', `/vendedor/threads?filter=${filter}&q=${encodeURIComponent(q)}&limit=100`))
      .body.threads as { id: string; unread: boolean; match?: string | null }[];

  beforeAll(async () => {
    await migrate(sql as unknown as Sql, join(import.meta.dir, '../db/migrations'));
    tenantId = await store('Forno da Vila');
    owner = await session(tenantId, 'owner');
    manager = await session(tenantId, 'manager');
    attendant = await session(tenantId, 'attendant');
    otherTenant = await store('Outra Loja');
    otherManager = await session(otherTenant, 'manager');
    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    process.env.VAPID_PUBLIC_KEY = Buffer.from(
      await crypto.subtle.exportKey('raw', vapid.publicKey),
    ).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!;
  });

  afterAll(async () => {
    if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = saved.pub;
    if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = saved.priv;
    if (tenants.length) await sql`delete from tenants where id = any(${tenants}::uuid[])`;
    await sql.end();
    await (app as unknown as { end: () => Promise<void> }).end();
  });

  test('opening a conversation reads it; a new message from the shopper makes it unread again', async () => {
    const t = await thread();
    await said(t.id, 'boa noite, vocês entregam?', 'shopper', 5);
    const row = async () => (await list(attendant)).find((r) => r.id === t.id)!;
    expect((await row()).unread).toBe(true);
    const seen = await attendant('POST', `/vendedor/threads/${t.id}/seen`, {});
    expect(seen.status).toBe(200);
    expect((await row()).unread).toBe(false);
    // Duá answered: never bold, read or not
    await said(t.id, 'Entregamos sim!', 'agent', 2);
    expect((await row()).unread).toBe(false);
    await said(t.id, 'e até que horas?', 'shopper', 0);
    expect((await row()).unread).toBe(true);
    expect((await attendant('POST', '/vendedor/threads/nope/seen', {})).status).toBe(400);
    expect(
      (await attendant('POST', `/vendedor/threads/${crypto.randomUUID()}/seen`, {})).status,
    ).toBe(404);
    // another store's conversation is as unknown as a made-up one
    expect((await otherManager('POST', `/vendedor/threads/${t.id}/seen`, {})).status).toBe(404);
  });

  test('search finds what was said and the order number, bounded and folded', async () => {
    const a = await thread({ name: 'Rafael' });
    await said(a.id, 'Quero um Pão de Queijo recheado, sem cebola');
    const friend = await thread({ name: 'Tia Lu', cls: 'personal' });
    await said(friend.id, 'pão de queijo no domingo?');
    const hits = await list(attendant, 'pao de queijo');
    expect(hits.map((r) => r.id)).toContain(a.id);
    expect(hits.find((r) => r.id === a.id)!.match).toContain('Pão de Queijo');
    // a friend's words are the owner's own: never searched, even under "pessoais"
    expect((await list(attendant, 'pao de queijo', 'personal')).map((r) => r.id)).not.toContain(
      friend.id,
    );
    // two letters search names and phones only
    expect((await list(attendant, 'qu')).map((r) => r.id)).not.toContain(a.id);
    // an old message is past the window
    const old = await thread({ name: 'Bruno' });
    const [m] = await sql<{ id: string }[]>`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, created_at)
      values (${tenantId}, ${old.id}, 'shopper', 'text', 'esfiha de zaatar', now() - interval '200 days')
      returning id`;
    expect(m).toBeTruthy();
    expect((await list(attendant, 'zaatar')).map((r) => r.id)).not.toContain(old.id);
    // "#N" finds the order's conversation
    const o = await thread({ name: 'Carla' });
    const [cart] = await sql<{ id: string }[]>`
      insert into carts (tenant_id, session_hash) values (${tenantId}, ${`qv-${nonce}-${++n}`})
      returning id`;
    const number = 7000 + n;
    await sql`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents, thread_id, source)
      values (${tenantId}, ${cart!.id}, ${number}, ${sql.json({ name: 'Carla', phone: o.phone })},
              ${o.phone}, ${sql.json({ mode: 'pickup' })},
              ${sql.json({ provider: 'sandbox', method: 'pix', status: 'pending' })},
              'placed', 4200, 4200, ${o.id}, 'whatsapp_agent')`;
    expect((await list(attendant, `#${number}`)).map((r) => r.id)).toContain(o.id);
    expect((await list(attendant, String(number))).map((r) => r.id)).toContain(o.id);
    // a "%" is a character, not a wildcard
    expect((await list(attendant, '%%%')).length).toBe(0);
  });

  test('pausing gates every conversation and lifts by itself; resuming answers who waited', async () => {
    const t = await thread();
    expect((await manager('POST', '/vendedor/pause', { for: '1h' })).status).toBe(409);
    await sql`insert into store_agent (tenant_id, enabled, settings) values
      (${tenantId}, true, ${sql.json({ coverage: 'always' })})
      on conflict (tenant_id) do update set enabled = true, settings = excluded.settings`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'open')
      on conflict (tenant_id) do update set state = 'open'`;
    expect((await attendant('POST', '/vendedor/pause', { for: '1h' })).status).toBe(403);
    expect((await manager('POST', '/vendedor/pause', { for: 'forever' })).status).toBe(422);
    const paused = await manager('POST', '/vendedor/pause', { for: '1h' });
    expect(paused.status).toBe(200);
    const until = new Date(paused.body.pausedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    const home = await attendant('GET', '/vendedor');
    expect(home.body.presence).toBe('paused');
    expect(home.body.agent.pausedUntil).toBe(paused.body.pausedUntil);
    expect((await attendant('GET', `/vendedor/threads/${t.id}`)).body.thread.floor).toBe('paused');

    // a message during the pause: dispatched as always, plus one wake for when it lapses
    const [m] = await sql<
      {
        id: string;
        tenant_id: string;
        thread_id: string;
        author: 'shopper';
        kind: string;
        body: string;
        meta: Record<string, unknown>;
        quoted_wa_id: null;
        wa_id: null;
        created_at: Date;
        ingest_attempts: number;
      }[]
    >`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, ingest)
      values (${tenantId}, ${t.id}, 'shopper', 'text', 'tem pizza hoje?', 'pending')
      returning id, tenant_id, thread_id, author, kind, body, meta, quoted_wa_id, wa_id, created_at, ingest_attempts`;
    await sql`update shopper_threads set last_in_at = now(), pending_since = now() where id = ${t.id}`;
    await ingestOne({ sql: app, media: null, gateway: null }, m!);
    const box = await sql<{ kind: string; source: string; deliver_at: Date }[]>`
      select b.kind, b.source, b.deliver_at from agent_mailbox b join agent_actors a on a.id = b.actor_id
      where a.tenant_id = ${tenantId} and a.subject_id = ${t.id} order by b.deliver_at`;
    expect(box.map((b) => b.kind)).toEqual(['message.inbound', 'timer.handback']);
    expect(box[1]!.source).toBe('vendedor:pause');
    expect(box[1]!.deliver_at.getTime()).toBe(until + 1000);

    // the clock passes the pause: nothing to clear, he's back
    await sql`update store_agent set paused_until = now() - interval '1 second' where tenant_id = ${tenantId}`;
    expect((await attendant('GET', '/vendedor')).body.presence).toBe('answering');
    expect((await attendant('GET', `/vendedor/threads/${t.id}`)).body.thread.floor).toBe('agent');

    // "até amanhã", then "voltar agora": the shopper still owed an answer gets one now
    const tomorrow = await manager('POST', '/vendedor/pause', { for: 'tomorrow' });
    const at = new Date(tomorrow.body.pausedUntil);
    expect(at.getTime()).toBeGreaterThan(Date.now());
    expect(at.getTime() - Date.now()).toBeLessThanOrEqual(30 * 3600_000);
    // 6 a.m. in São Paulo is 09:00 UTC
    expect(at.getUTCHours()).toBe(9);
    const back = await manager('POST', '/vendedor/resume', {});
    expect(back.status).toBe(200);
    expect(back.body.pausedUntil).toBeNull();
    const woke = await sql<{ source: string }[]>`
      select b.source from agent_mailbox b join agent_actors a on a.id = b.actor_id
      where a.tenant_id = ${tenantId} and a.subject_id = ${t.id} and b.dedupe_key like 'resume:%'`;
    expect(woke).toHaveLength(1);
    expect((await attendant('GET', '/vendedor')).body.presence).toBe('answering');
  });

  test('a shopper left waiting pings again at 5 and 15 min, falls back to WhatsApp once, and stops once answered', async () => {
    expect(WAITING_REPINGS).toEqual([5, 15]);
    const t = await thread({ name: 'Júlia' });
    await said(t.id, 'meu pedido veio errado');
    // the owner turned these alerts off: no WhatsApp for them either
    await sql`update merchant_users set prefs = ${sql.json({ pushWaiting: false })}
      where tenant_id = ${tenantId} and role = 'owner'`;
    const sent: { phone: string; text: string }[] = [];
    const notify = {
      whatsapp: async (phone: string, text: string) => void sent.push({ phone, text }),
      email: async () => undefined,
    };
    const keys = async () =>
      (
        await sql<{ key: string }[]>`
          select key from push_deliveries where tenant_id = ${tenantId} and key like ${`vendedor.%:${t.id}:%`}`
      )
        .map((r) => r.key.split(':').slice(0, 1).concat(r.key.split(':').slice(-1)).join('@'))
        .sort();
    const wait = async (mins: number) => {
      await sql`update shopper_threads set waiting_since = now() - make_interval(mins => ${mins}),
        owner = 'human', owner_reason = 'reclamação' where id = ${t.id}`;
      const [r] = await sql<
        { since: Date }[]
      >`select waiting_since as since from shopper_threads where id = ${t.id}`;
      return r!.since;
    };
    let since = await wait(2);
    await vendedorWaitingAlerts(app, tenantId, { notify, adminOrigin: 'https://admin.qv.test' });
    expect(sent).toHaveLength(0);

    since = await wait(6);
    await vendedorWaitingAlerts(app, tenantId, { notify, adminOrigin: 'https://admin.qv.test' });
    await vendedorWaitingAlerts(app, tenantId, { notify, adminOrigin: 'https://admin.qv.test' });
    const ping5 = await sql`select 1 from push_deliveries where tenant_id = ${tenantId}
      and key = ${`vendedor.waiting:${t.id}:${since.toISOString()}:5`}`;
    expect(ping5).toHaveLength(1);
    // no device took the ping: the manager hears it on WhatsApp, once; the shopper's name stays out
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(`https://admin.qv.test/admin/vendedor/conversas/${t.id}`);
    expect(sent[0]!.text).not.toContain('Júlia');

    // the clock can't be moved here, so the next handoff stands for "16 min in"; this time a
    // device took a ping: the 15-min one goes out and WhatsApp stays quiet
    since = await wait(16);
    await sql`insert into push_attempts (tenant_id, user_id, event, ref, channel, result)
      values (${tenantId}, null, 'vendedor.waiting', ${t.id}, 'push', 'ok')`;
    await vendedorWaitingAlerts(app, tenantId, { notify });
    expect(
      await sql`select 1 from push_deliveries where tenant_id = ${tenantId}
        and key = ${`vendedor.waiting:${t.id}:${since.toISOString()}:15`}`,
    ).toHaveLength(1);
    expect(
      await sql`select 1 from push_deliveries where tenant_id = ${tenantId}
        and key = ${`vendedor.waiting:${t.id}:${since.toISOString()}:5`}`,
    ).toHaveLength(0);
    expect(sent).toHaveLength(1);
    // past the last ping minute nothing more is claimed for it
    const claimed = (await keys()).length;
    await vendedorWaitingAlerts(app, tenantId, { notify });
    expect((await keys()).length).toBe(claimed);

    // answered: it stops
    const before = (await keys()).length;
    await manager('POST', `/vendedor/threads/${t.id}/reply`, { text: 'Já vou ver, desculpe!' });
    expect(
      (
        await sql<
          { w: Date | null }[]
        >`select waiting_since as w from shopper_threads where id = ${t.id}`
      )[0]!.w,
    ).toBeNull();
    await vendedorWaitingAlerts(app, tenantId, { notify });
    expect((await keys()).length).toBe(before);
    expect(sent.length).toBe(1);
    void owner;
  });

  test('quick replies: the team uses them, managers keep them, each store sees its own', async () => {
    expect((await attendant('POST', '/vendedor/quick-replies', { text: 'oi' })).status).toBe(403);
    const made = await manager('POST', '/vendedor/quick-replies', {
      text: '  Seu pedido já saiu para entrega!  ',
    });
    expect(made.status).toBe(201);
    expect(made.body.replies).toHaveLength(1);
    expect(made.body.replies[0].text).toBe('Seu pedido já saiu para entrega!');
    const id = made.body.replies[0].id as string;
    expect((await attendant('GET', '/vendedor/quick-replies')).body.replies).toHaveLength(1);
    expect(
      (await manager('POST', '/vendedor/quick-replies', { text: 'x'.repeat(501) })).status,
    ).toBe(422);
    expect((await manager('POST', '/vendedor/quick-replies', { text: '   ' })).status).toBe(422);
    const edited = await manager('PATCH', `/vendedor/quick-replies/${id}`, {
      text: 'Saiu para entrega agora!',
    });
    expect(edited.body.replies[0].text).toBe('Saiu para entrega agora!');
    // another store: can't see, change or delete it
    expect((await otherManager('GET', '/vendedor/quick-replies')).body.replies).toHaveLength(0);
    expect(
      (await otherManager('PATCH', `/vendedor/quick-replies/${id}`, { text: 'meu' })).status,
    ).toBe(404);
    expect((await otherManager('DELETE', `/vendedor/quick-replies/${id}`)).status).toBe(404);
    expect((await manager('DELETE', '/vendedor/quick-replies/nope')).status).toBe(400);
    // bounded: 30 per store
    for (let i = 1; i < 30; i++)
      expect(
        (await manager('POST', '/vendedor/quick-replies', { text: `resposta ${i}` })).status,
      ).toBe(201);
    const full = await manager('POST', '/vendedor/quick-replies', { text: 'uma a mais' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('QUICK_REPLIES_FULL');
    const gone = await manager('DELETE', `/vendedor/quick-replies/${id}`);
    expect(gone.body.replies).toHaveLength(29);
    // "desfazer" puts it back where it was
    const again = await manager('POST', '/vendedor/quick-replies', {
      text: 'Saiu para entrega agora!',
      position: 0,
    });
    expect(again.body.replies[0].text).toBe('Saiu para entrega agora!');
    expect((await manager('DELETE', `/vendedor/quick-replies/${id}`)).status).toBe(404);
  });

  test('several "para decidir" at once: bounded, idempotent, the same rules as one', async () => {
    const asks = await Promise.all([1, 2, 3].map(() => thread({ cls: 'ask' })));
    const ids = asks.map((a) => a.id);
    expect(
      (await attendant('POST', '/vendedor/threads/classify', { ids, as: 'personal' })).status,
    ).toBe(403);
    expect(
      (await attendant('POST', '/vendedor/threads/classify', { ids: [], as: 'shopper' })).status,
    ).toBe(422);
    expect(
      (
        await attendant('POST', '/vendedor/threads/classify', {
          ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
          as: 'shopper',
        })
      ).status,
    ).toBe(422);
    expect(
      (await attendant('POST', '/vendedor/threads/classify', { ids: ['nope'], as: 'shopper' }))
        .status,
    ).toBe(422);
    const stranger = crypto.randomUUID();
    const foreign = await thread({ cls: 'ask', tid: otherTenant });
    const key = `${nonce}-bulk`;
    const done = await attendant(
      'POST',
      '/vendedor/threads/classify',
      { ids: [...ids, stranger, foreign.id], as: 'shopper' },
      key,
    );
    expect(done.status).toBe(200);
    expect([...done.body.classified].sort()).toEqual([...ids].sort());
    expect([...done.body.skipped].sort()).toEqual([stranger, foreign.id].sort());
    const rows = await sql<{ class: string; class_source: string }[]>`
      select class, class_source from shopper_threads where id = any(${ids}::uuid[])`;
    expect(rows.every((r) => r.class === 'shopper' && r.class_source === 'owner')).toBe(true);
    expect(
      (
        await sql<{ class: string }[]>`select class from shopper_threads where id = ${foreign.id}`
      )[0]!.class,
    ).toBe('ask');
    // the same key replays the answer and writes nothing twice
    const replay = await attendant(
      'POST',
      '/vendedor/threads/classify',
      { ids: [...ids, stranger, foreign.id], as: 'shopper' },
      key,
    );
    expect(replay.body).toEqual(done.body);
    const logged = await sql`select 1 from audit_log where tenant_id = ${tenantId}
      and action = 'vendedor.classify' and after ->> 'as' = 'shopper'`;
    expect(logged).toHaveLength(1);
  });

  test('a note about a customer, written by the store: bounded, marked as the store’s', async () => {
    const t = await thread();
    const add = await manager('POST', `/customers/${t.phone}/vendedor/facts`, {
      text: '  sem   cebola no X-Salada ',
    });
    expect(add.status).toBe(201);
    expect(add.body.facts).toMatchObject([
      { label: 'nota_da_loja', value: 'sem cebola no X-Salada', source: 'store', sensitive: false },
    ]);
    const [row] = await sql<{ scope: string; provenance: string }[]>`
      select scope, provenance from agent_memory where tenant_id = ${tenantId} and key like 'nota\\_da\\_loja.%'`;
    expect(row!.scope).toBe(`shopper_thread:${t.id}`);
    expect(row!.provenance).toStartWith('merchant:');
    // health words: Duá confirms before using it
    const health = await manager('POST', `/customers/${t.phone}/vendedor/facts`, {
      text: 'alérgico a camarão',
    });
    expect(
      health.body.facts.find((f: { value: string }) => f.value === 'alérgico a camarão').sensitive,
    ).toBe(true);
    expect(
      (await attendant('POST', `/customers/${t.phone}/vendedor/facts`, { text: 'oi oi' })).status,
    ).toBe(403);
    expect(
      (await manager('POST', `/customers/${t.phone}/vendedor/facts`, { text: 'x'.repeat(201) }))
        .status,
    ).toBe(422);
    const nobody = await manager('POST', `/customers/${phoneOf()}/vendedor/facts`, {
      text: 'paga no Pix',
    });
    expect(nobody.status).toBe(409);
    expect(nobody.body.error.code).toBe('NO_CONVERSATION');
    expect(
      (await manager('POST', '/customers/12/vendedor/facts', { text: 'paga no Pix' })).status,
    ).toBe(400);
    // another store can't write into this customer's conversation
    expect(
      (await otherManager('POST', `/customers/${t.phone}/vendedor/facts`, { text: 'paga no Pix' }))
        .status,
    ).toBe(409);
    // forgotten like any fact
    const key = add.body.facts.find((f: { value: string }) => f.value.startsWith('sem cebola')).key;
    const forgot = await manager('DELETE', `/customers/${t.phone}/vendedor/facts/${key}`);
    expect(forgot.status).toBe(200);
    expect(forgot.body.facts).toHaveLength(1);
  });
});
