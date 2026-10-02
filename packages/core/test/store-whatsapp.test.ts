import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pino from 'pino';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { unseal } from '../src/platform/secrets.ts';
import { authStore, LeaseLost } from '../src/store-whatsapp/auth-store.ts';
import { Gateway } from '../src/store-whatsapp/gateway.ts';
import {
  enqueueOrderMessageTx,
  OPT_OUT_FOOTER,
  renderOrderMessage,
  type OrderFacts,
} from '../src/store-whatsapp/messages.ts';
import type {
  ConnectionUpdate,
  Creds,
  SocketKeys,
  WaRuntime,
  WaSocket,
} from '../src/store-whatsapp/session.ts';
import { housekeeping } from '../src/store-whatsapp/state.ts';
import {
  jidForPhone,
  messageIdFor,
  optKeyword,
  phoneForJid,
  phoneVariants,
  reconnectDelayMs,
  retryDelayMs,
} from '../src/store-whatsapp/text.ts';
import { checkGateway } from '../src/store-whatsapp/watch.ts';

// ADR 0026: a store's own WhatsApp, linked as a device and run by the wa-gateway process.

describe('store whatsapp: pure rules', () => {
  test('numbers: national ↔ jid, and both 9th-digit forms of a mobile', () => {
    expect(jidForPhone('11987654321')).toBe('5511987654321@s.whatsapp.net');
    expect(jidForPhone('5511987654321')).toBe('5511987654321@s.whatsapp.net');
    expect(jidForPhone('123')).toBeNull();
    expect(phoneForJid('5511987654321:3@s.whatsapp.net')).toBe('11987654321');
    expect(phoneForJid('123@lid')).toBeNull();
    expect(phoneForJid('14155550100@s.whatsapp.net')).toBeNull();
    expect(phoneVariants('11987654321')).toEqual(['11987654321', '1187654321']);
    expect(phoneVariants('1187654321')).toEqual(['1187654321', '11987654321']);
    // a landline has one form
    expect(phoneVariants('1133334444')).toEqual(['1133334444']);
  });

  test('message ids are stable per row and shaped like baileys ids', () => {
    const a = messageIdFor('7d1c0a9e-0000-4000-8000-000000000001');
    expect(a).toBe(messageIdFor('7d1c0a9e-0000-4000-8000-000000000001'));
    expect(a).not.toBe(messageIdFor('7d1c0a9e-0000-4000-8000-000000000002'));
    expect(a).toMatch(/^3EB0[0-9A-F]{18}$/);
  });

  test('only a bare keyword opts out or back in', () => {
    expect(optKeyword('SAIR')).toBe('out');
    expect(optKeyword(' Parar! ')).toBe('out');
    expect(optKeyword('stop')).toBe('out');
    expect(optKeyword('voltar')).toBe('in');
    expect(optKeyword('pode parar de mandar?')).toBeNull();
    expect(optKeyword('cancelar')).toBeNull();
    expect(optKeyword('x'.repeat(50))).toBeNull();
  });

  test('backoffs grow and cap', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(9)).toBe(30 * 60_000);
    expect(reconnectDelayMs(1, () => 0.5)).toBe(2_000);
    expect(reconnectDelayMs(30, () => 0.5)).toBe(5 * 60_000);
  });

  test('every step reads well; a delivery order says nothing at "pronto"', () => {
    const facts: OrderFacts = {
      storeName: 'Doce Lar',
      firstName: 'Ana',
      number: 42,
      mode: 'delivery',
      totalCents: 5890,
      promisedFrom: '2026-10-02T22:40:00.000Z',
      promisedTo: '2026-10-02T22:55:00.000Z',
      scheduledFor: null,
      timezone: 'America/Sao_Paulo',
    };
    const placed = renderOrderMessage('placed', facts)!;
    expect(placed).toContain('Oi, Ana!');
    expect(placed).toContain('Doce Lar');
    expect(placed).toContain('#42');
    expect(placed).toContain('R$');
    expect(placed).toContain('58,90');
    expect(renderOrderMessage('confirmed', facts)).toContain('Chega entre 19:40 e 19:55');
    expect(renderOrderMessage('confirmed', { ...facts, mode: 'pickup' })).toContain(
      'Fica pronto por volta das 19:55',
    );
    expect(renderOrderMessage('ready', facts)).toBeNull();
    expect(renderOrderMessage('ready', { ...facts, mode: 'pickup' })).toContain('retirar');
    const encomenda = {
      ...facts,
      scheduledFor: '2026-10-12',
      promisedFrom: null,
      promisedTo: null,
    };
    expect(renderOrderMessage('placed', encomenda)).toContain('encomenda #42 para 12/10');
    expect(renderOrderMessage('confirmed', encomenda)).not.toContain('Chega');
  });
});

// ── a fake WhatsApp the tests drive ─────────────────────────────────────────

type Handler = (payload: never) => void;

class FakeSocket implements WaSocket {
  private handlers = new Map<string, Handler[]>();
  sent: { jid: string; text: string; id?: string | undefined }[] = [];
  pairCalls: string[] = [];
  loggedOut = false;
  ended = false;
  failNext: Error | null = null;
  user: WaSocket['user'] = undefined;
  ev = {
    on: (event: string, cb: Handler) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    },
  } as WaSocket['ev'];

  constructor(
    readonly creds: Creds,
    readonly keys: SocketKeys,
    private world: FakeWorld,
  ) {}

  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload as never);
  }
  connection(u: ConnectionUpdate) {
    this.emit('connection.update', u);
  }
  close(statusCode?: number) {
    this.connection({
      connection: 'close',
      ...(statusCode ? { lastDisconnect: { error: { output: { statusCode } } } } : {}),
    });
  }
  async requestPairingCode(phone: string) {
    this.pairCalls.push(phone);
    return 'ABCD1234';
  }
  async onWhatsApp(...jids: string[]) {
    return jids.map((jid) => ({ jid, exists: this.world.registered.has(jid) }));
  }
  async sendMessage(jid: string, content: { text: string }, opts?: { messageId?: string }) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.sent.push({ jid, text: content.text, id: opts?.messageId });
    this.world.outbox.push({ jid, text: content.text, id: opts?.messageId });
    return { key: { id: opts?.messageId ?? 'x' } };
  }
  async logout() {
    this.loggedOut = true;
    this.close(401);
  }
  end() {
    this.ended = true;
  }
}

class FakeWorld {
  sockets: FakeSocket[] = [];
  /** jids WhatsApp knows */
  registered = new Set<string>();
  outbox: { jid: string; text: string; id?: string | undefined }[] = [];
  get last(): FakeSocket {
    return this.sockets[this.sockets.length - 1]!;
  }
  runtime(): WaRuntime {
    return {
      codec: { replacer: (_k, v) => v, reviver: (_k, v) => v },
      initCreds: () => ({ noiseKey: 'fresh' }),
      normalize: (m) => m,
      connect: async ({ creds, keys }) => {
        const s = new FakeSocket(creds, keys, this);
        this.sockets.push(s);
        return s;
      },
    };
  }
}

async function until(cond: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('store whatsapp: gateway + admin (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // as vendua_app when the run provides it, so RLS is part of the test
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `wa-${nonce}`;
  const host = `${slug}.localhost`;
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2195${stamp}`;
  const managerPhone = `2196${stamp}`;
  // a mobile WhatsApp knows without the 9th digit: orders keep the 9, the jid doesn't
  const shopperPhone = `2198${stamp.slice(1)}1`;
  const shopperJid = `55218${stamp.slice(1)}1@s.whatsapp.net`;
  const silent = pino({ level: 'silent' });
  let tenantId = '';
  let otherTenant = '';
  let idem = 0;
  let number = 0;
  const world = new FakeWorld();
  let gw: Gateway;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const signIn = async (phone: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie });
  };
  let owner: Awaited<ReturnType<typeof signIn>>;
  let manager: Awaited<ReturnType<typeof signIn>>;

  const order = async (o: { mode: 'pickup' | 'delivery'; state?: string; phone?: string }) => {
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenantId}, ${`wa-${nonce}-${++number}`})
        returning id`
    )[0]!.id;
    return (
      await sql<{ id: string }[]>`
        insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                            state, subtotal_cents, total_cents)
        values (${tenantId}, ${cart}, ${number}, ${sql.json({ name: 'Bia Souza', phone: o.phone ?? shopperPhone })},
                ${o.phone ?? shopperPhone}, ${sql.json({ mode: o.mode })},
                ${sql.json({ provider: 'sandbox', method: 'pix', status: 'pending' })},
                ${o.state ?? 'placed'}, 4590, 4590)
        returning id`
    )[0]!.id;
  };
  const move = (id: string, to: string) => owner('POST', `/orders/${id}/transition`, { to });
  const messages = () =>
    sql<
      {
        id: string;
        kind: string;
        event: string | null;
        status: string;
        body: string;
        wa_id: string | null;
        error: string | null;
        attempts: number;
        delivered_at: Date | null;
        read_at: Date | null;
      }[]
    >`select id, kind, event, status, body, wa_id, error, attempts, delivered_at, read_at
      from store_wa_messages where tenant_id = ${tenantId} order by created_at`;
  const waRow = async () =>
    (
      await sql<Record<string, any>[]>`select * from store_whatsapp where tenant_id = ${tenantId}`
    )[0]!;
  const newGateway = (id: string) =>
    new Gateway({
      sql: appSql,
      runtime: world.runtime(),
      sealSecret: 's',
      id,
      listen: false,
      tickMs: 3_600_000,
      leaseMs: 600_000,
      minSendGapMs: 1,
      reconnectDelay: () => 5,
      tenants: [tenantId],
      log: silent,
    });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Doce ' + nonce}) returning id`
    )[0]!.id;
    otherTenant = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug + '-b'}, ${'Outra ' + nonce}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, whatsapp)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, ${'5521' + stamp + '9'})`;
    await sql`insert into merchant_users (tenant_id, name, phone, role)
              values (${tenantId}, 'Rita', ${ownerPhone}, 'owner'),
                     (${tenantId}, 'Caio', ${managerPhone}, 'manager')`;
    owner = await signIn(ownerPhone);
    manager = await signIn(managerPhone);
    world.registered.add(shopperJid);
    world.registered.add(`55${managerPhone}@s.whatsapp.net`);
  });

  afterAll(async () => {
    await gw?.stop();
    await sql`delete from wa_gateways where id like ${'gw-' + nonce + '%'}`;
    await sql`delete from staff_events where tenant_id = any(${[tenantId, otherTenant]})`;
    if (tenantId) await sql`delete from tenants where id = any(${[tenantId, otherTenant]})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('off at first: suggests the store number; pairing needs a running gateway', async () => {
    const v = await owner('GET', '/whatsapp');
    expect(v.status).toBe(200);
    expect(v.body.state).toBe('off');
    expect(v.body.available).toBe(false);
    expect(v.body.suggestedPhone).toBe(`21${stamp}9`);
    expect(v.body.events.placed).toBe(true);
    expect(v.body.events.preparing).toBe(false);
    expect(v.body.previews.ready).toContain('retirar');
    const r = await owner('POST', '/whatsapp/pair', { phone: ownerPhone });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('WHATSAPP_UNAVAILABLE');
  });

  test('pairing: code on screen, confirmed on the phone, open as the store number', async () => {
    gw = newGateway(`gw-${nonce}-a`);
    await gw.tick(); // heartbeat: the admin now sees a live gateway
    expect((await owner('GET', '/whatsapp')).body.available).toBe(true);

    // only the owner links the number; a bad number is a 422
    expect((await manager('POST', '/whatsapp/pair', { phone: ownerPhone })).status).toBe(403);
    expect((await owner('POST', '/whatsapp/pair', { phone: '123' })).status).toBe(422);

    const r = await owner('POST', '/whatsapp/pair', {
      phone: `+55 (21) 9${stamp.slice(0, 4)}-${stamp.slice(4)}0`,
    });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('connecting');

    await gw.tick();
    await until(() => world.sockets.length === 1);
    const s = world.last;
    s.connection({ qr: 'ref-1' });
    await until(async () => (await waRow())?.state === 'pairing');
    expect(s.pairCalls).toEqual([`55219${stamp.slice(0, 4)}${stamp.slice(4)}0`]);
    const shown = await owner('GET', '/whatsapp');
    expect(shown.body.state).toBe('pairing');
    expect(shown.body.pairCode).toBe('ABCD1234');
    expect(new Date(shown.body.pairCodeExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // the provisional `me` a code request sets never reaches the database
    s.creds.me = { id: 'provisional' };
    s.emit('creds.update', {});
    await new Promise((r2) => setTimeout(r2, 50));
    const stored = await withTenant(
      appSql,
      tenantId,
      (tx) =>
        tx<
          { n: number }[]
        >`select count(*)::int as n from store_wa_auth where tenant_id = ${tenantId}`,
    );
    expect(stored[0]!.n).toBe(1);
    const box = await sql<{ data: string }[]>`
      select data from store_wa_auth where tenant_id = ${tenantId} and category = 'creds'`;
    const creds = JSON.parse(unseal(JSON.parse(box[0]!.data), 's')!);
    expect(creds.noiseKey).toBe('fresh');
    expect(creds.me).toBeUndefined();

    // the merchant typed the code: WhatsApp confirms, restarts the stream, the socket opens
    s.creds.registered = true;
    s.creds.me = { id: `55${ownerPhone}:7@s.whatsapp.net`, name: 'Doce' };
    s.emit('creds.update', {});
    s.connection({ isNewLogin: true });
    s.close(515);
    await until(() => world.sockets.length === 2);
    const s2 = world.last;
    s2.user = { id: `55${ownerPhone}:7@s.whatsapp.net`, name: 'Doce Lar' };
    s2.connection({ connection: 'open' });
    await until(async () => (await waRow())?.state === 'open');
    const v = await owner('GET', '/whatsapp');
    expect(v.body.state).toBe('open');
    expect(v.body.phone).toBe(`55${ownerPhone}`);
    expect(v.body.name).toBe('Doce Lar');
    expect(v.body.pairCode).toBeNull();
    const ev = await sql<{ data: { step: string } }[]>`
      select data from staff_events where tenant_id = ${tenantId} and kind = 'whatsapp.store'`;
    expect(ev.map((e) => e.data.step)).toEqual(['connected']);
    // the login is sealed: nothing readable at rest
    const raw = await sql<{ data: string }[]>`
      select data from store_wa_auth where tenant_id = ${tenantId} and category = 'creds'`;
    expect(raw[0]!.data).not.toContain(ownerPhone);
    expect(JSON.parse(raw[0]!.data).v).toBe(1);
  });

  test('order steps reach the shopper from the store number, once each', async () => {
    const id = await order({ mode: 'delivery' });
    await withTenant(appSql, tenantId, (tx) => enqueueOrderMessageTx(tx, tenantId, id, 'placed'));
    // a replay of the same step queues nothing new
    await withTenant(appSql, tenantId, (tx) => enqueueOrderMessageTx(tx, tenantId, id, 'placed'));
    expect((await move(id, 'confirmed')).status).toBe(200);
    expect((await move(id, 'preparing')).status).toBe(200); // off by default
    expect((await move(id, 'ready')).status).toBe(200); // says nothing on a delivery order
    expect((await move(id, 'out_for_delivery')).status).toBe(200);
    gw.pump(tenantId);
    await until(async () => (await messages()).every((m) => m.status === 'sent'));
    const rows = await messages();
    expect(rows.map((m) => m.event)).toEqual(['placed', 'confirmed', 'out_for_delivery']);
    // the first message to a number says how to stop them; the rest don't repeat it
    expect(rows[0]!.body.endsWith(OPT_OUT_FOOTER)).toBe(true);
    expect(rows[1]!.body).not.toContain('SAIR');
    expect(rows[0]!.body).toContain('Oi, Bia!');
    // sent to the jid WhatsApp knows, with the row's own stable id
    const s = world.last;
    expect(s.sent.map((m) => m.jid)).toEqual([shopperJid, shopperJid, shopperJid]);
    expect(s.sent.map((m) => m.id)).toEqual(rows.map((m) => messageIdFor(m.id)));
    expect(rows.map((m) => m.wa_id)).toEqual(rows.map((m) => messageIdFor(m.id)));

    // receipts come back as delivered / read
    s.emit('messages.update', [
      { key: { id: rows[0]!.wa_id, fromMe: true }, update: { status: 3 } },
      { key: { id: rows[1]!.wa_id, fromMe: true }, update: { status: 4 } },
    ]);
    await until(async () => (await messages())[1]!.read_at !== null);
    const after = await messages();
    expect(after[0]!.delivered_at).not.toBeNull();
    expect(after[0]!.read_at).toBeNull();

    const v = await owner('GET', '/whatsapp');
    expect(v.body.recent.length).toBe(3);
    expect(v.body.stats.sent).toBe(3);
  });

  test('a number not on WhatsApp fails at once; a flaky send retries, then gives up', async () => {
    const nobody = await order({ mode: 'pickup', phone: '2133334444' });
    await move(nobody, 'confirmed');
    gw.pump(tenantId);
    await until(async () =>
      (await messages()).some((m) => m.status === 'failed' && m.error === 'not_on_whatsapp'),
    );

    await sql`delete from store_wa_messages where tenant_id = ${tenantId}`;
    const flaky = await order({ mode: 'pickup' });
    world.last.failNext = new Error('stream errored');
    await move(flaky, 'confirmed');
    gw.pump(tenantId);
    await until(
      async () =>
        (await messages())[0]?.status === 'pending' && (await messages())[0]!.attempts === 1,
    );
    const m = (await messages())[0]!;
    expect(m.error).toBe('stream errored');
    // due again: same row, same id, sent this time
    await sql`update store_wa_messages set next_attempt_at = now() where id = ${m.id}`;
    gw.pump(tenantId);
    await until(async () => (await messages())[0]?.status === 'sent');
    expect(world.last.sent.at(-1)!.id).toBe(messageIdFor(m.id));
  });

  test('a send cut off mid-flight goes again with the same id (WhatsApp dedupes it)', async () => {
    await sql`delete from store_wa_messages where tenant_id = ${tenantId}`;
    const id = await order({ mode: 'pickup' });
    await withTenant(appSql, tenantId, (tx) =>
      enqueueOrderMessageTx(tx, tenantId, id, 'confirmed'),
    );
    const row = (await messages())[0]!;
    // a gateway died after claiming it: 'sending' with a lapsed lease
    await sql`update store_wa_messages set status = 'sending', attempts = 1, wa_id = ${messageIdFor(row.id)},
              lease_until = now() - interval '1 second' where id = ${row.id}`;
    gw.pump(tenantId);
    await until(async () => (await messages())[0]?.status === 'sent');
    expect(world.last.sent.at(-1)!.id).toBe(messageIdFor(row.id));
  });

  test('the SAIR footer goes on the first message that actually reaches the shopper', async () => {
    await sql`delete from store_wa_messages where tenant_id = ${tenantId}`;
    // an earlier attempt that never went out doesn't count as having told them
    await sql`insert into store_wa_messages (tenant_id, kind, event, phone, body, status, error)
              values (${tenantId}, 'order', 'placed', ${shopperPhone}, 'x', 'failed', 'gave up')`;
    const id = await order({ mode: 'pickup' });
    await move(id, 'confirmed');
    gw.pump(tenantId);
    await until(async () => (await messages()).some((m) => m.status === 'sent'));
    const sent = (await messages()).find((m) => m.status === 'sent')!;
    expect(sent.body.endsWith(OPT_OUT_FOOTER)).toBe(true);
    expect(world.last.sent.at(-1)!.text.endsWith(OPT_OUT_FOOTER)).toBe(true);
  });

  test('SAIR stops this store texting that shopper; VOLTAR brings it back', async () => {
    await sql`delete from store_wa_messages where tenant_id = ${tenantId}`;
    const first = await order({ mode: 'pickup' });
    await move(first, 'confirmed');
    gw.pump(tenantId);
    await until(async () => (await messages())[0]?.status === 'sent');

    // a stranger's "sair" is just a message to the store
    world.last.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5521900000000@s.whatsapp.net', id: 'in-0' },
          message: { conversation: 'sair' },
        },
      ],
    });
    world.last.emit('messages.upsert', {
      type: 'notify',
      messages: [{ key: { remoteJid: shopperJid, id: 'in-1' }, message: { conversation: 'SAIR' } }],
    });
    await until(async () =>
      (await messages()).some((m) => m.kind === 'opt_out' && m.status === 'sent'),
    );
    const outs = await sql`select phone from store_wa_optouts where tenant_id = ${tenantId}`;
    expect(outs.map((o) => o.phone)).toEqual([shopperPhone]);

    const second = await order({ mode: 'pickup' });
    await move(second, 'confirmed');
    expect((await messages()).filter((m) => m.kind === 'order').length).toBe(1);
    // SAIR and VOLTAR arriving together (offline delivery) apply in order: VOLTAR wins
    await sql`delete from store_wa_optouts where tenant_id = ${tenantId}`;
    world.last.emit('messages.upsert', {
      type: 'append',
      messages: [
        { key: { remoteJid: shopperJid, id: 'in-b1' }, message: { conversation: 'sair' } },
        { key: { remoteJid: shopperJid, id: 'in-b2' }, message: { conversation: 'voltar' } },
      ],
    });
    await until(async () => (await messages()).some((m) => m.kind === 'opt_in'));
    expect((await sql`select 1 from store_wa_optouts where tenant_id = ${tenantId}`).length).toBe(
      0,
    );
    await sql`delete from store_wa_messages where tenant_id = ${tenantId} and kind in ('opt_out', 'opt_in')`;
    await sql`insert into store_wa_optouts (tenant_id, phone) values (${tenantId}, ${shopperPhone})`;
    // 30-day retention took the history: VOLTAR must still work off the opt-out itself
    await sql`delete from store_wa_messages where tenant_id = ${tenantId} and kind = 'order'`;

    world.last.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: shopperJid, id: 'in-2' },
          message: { extendedTextMessage: { text: 'Voltar' } },
        },
      ],
    });
    await until(async () =>
      (await messages()).some((m) => m.kind === 'opt_in' && m.status === 'sent'),
    );
    expect((await sql`select 1 from store_wa_optouts where tenant_id = ${tenantId}`).length).toBe(
      0,
    );
    await move(second, 'preparing');
    await move(second, 'ready');
    await until(async () => (await messages()).some((m) => m.event === 'ready'));
  });

  test('a payment the store confirms by hand tells the shopper too', async () => {
    const id = await order({ mode: 'pickup' });
    const r = await owner('POST', `/orders/${id}/payment`, { status: 'paid' });
    expect(r.status).toBe(200);
    const paid = await sql<{ event: string }[]>`
      select event from store_wa_messages where order_id = ${id}`;
    expect(paid.map((m) => m.event)).toEqual(['paid']);
  });

  test('accepting with a prep time tells the shopper the new time, not the checkout estimate', async () => {
    const id = await order({ mode: 'pickup' });
    const r = await owner('POST', `/orders/${id}/transition`, { to: 'confirmed', prepMinutes: 45 });
    expect(r.status).toBe(200);
    const msg = (
      await sql<{ body: string }[]>`
        select body from store_wa_messages where order_id = ${id} and event = 'confirmed'`
    )[0]!;
    const promised = new Date(r.body.order.delivery.promisedTo);
    const hhmm = promised.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(msg.body).toContain(`por volta das ${hhmm}`);
  });

  test('two quick toggles both stick', async () => {
    const [a, b] = await Promise.all([
      manager('PATCH', '/whatsapp/settings', { events: { delivered: true } }),
      manager('PATCH', '/whatsapp/settings', { events: { preparing: true } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const ev = (await waRow()).events as string[];
    expect(ev).toContain('delivered');
    expect(ev).toContain('preparing');
    await manager('PATCH', '/whatsapp/settings', {
      events: { delivered: false, preparing: false },
    });
  });

  test('settings choose the steps; the test message goes to the signed-in person', async () => {
    const bad = await manager('PATCH', '/whatsapp/settings', { events: { nope: true } });
    expect(bad.status).toBe(422);
    const r = await manager('PATCH', '/whatsapp/settings', {
      events: { preparing: true, placed: false },
    });
    expect(r.status).toBe(200);
    expect(r.body.events.preparing).toBe(true);
    expect(r.body.events.placed).toBe(false);
    expect((await waRow()).events).toContain('preparing');

    const t = await manager('POST', '/whatsapp/test', {});
    expect(t.status).toBe(200);
    expect((await manager('POST', '/whatsapp/test', {})).status).toBe(429);
    gw.pump(tenantId);
    await until(() => world.outbox.some((m) => m.jid === `55${managerPhone}@s.whatsapp.net`));
  });

  test('an outage reaches the team once, however many reconnects fail, and closes on "back"', async () => {
    for (let i = 0; i < 8; i++) {
      const n = world.sockets.length;
      world.last.close(408);
      await until(() => world.sockets.length === n + 1);
    }
    await until(async () => (await waRow()).state === 'error');
    expect((await waRow()).outage_since).not.toBeNull();
    world.last.user = { id: `55${ownerPhone}:7@s.whatsapp.net`, name: 'Doce Lar' };
    world.last.connection({ connection: 'open' });
    await until(async () => (await waRow()).state === 'open');
    expect((await waRow()).outage_since).toBeNull();
    const ev = await sql<{ data: { step: string } }[]>`
      select data from staff_events where tenant_id = ${tenantId} and kind = 'whatsapp.store'
      order by id`;
    expect(ev.map((e) => e.data.step)).toEqual(['connected', 'lost', 'back']);
  });

  test('the lease fences every write: a second gateway waits, a stale epoch is refused', async () => {
    const other = newGateway(`gw-${nonce}-b`);
    await other.tick();
    expect(other.health().sessions).toBe(0);
    await other.stop();

    const row = await waRow();
    const stale = authStore(
      appSql,
      tenantId,
      { owner: row.owner, epoch: Number(row.lease_epoch) - 1 },
      { replacer: (_k, v) => v, reviver: (_k, v) => v },
      's',
    );
    await expect(stale.writeMany([{ category: 'x', name: 'y', value: 1 }])).rejects.toBeInstanceOf(
      LeaseLost,
    );
  });

  test('another store never reads this one’s login (RLS)', async () => {
    if (appSql === sql) return; // only meaningful as vendua_app
    const seen = await withTenant(
      appSql,
      otherTenant,
      (tx) => tx`select 1 from store_wa_auth where tenant_id = ${tenantId}`,
    );
    expect(seen.length).toBe(0);
  });

  test('a lease this process no longer runs is handed back, not renewed', async () => {
    const other = newGateway(`gw-${nonce}-c`);
    const before = await waRow();
    // the database still names a gateway that dropped the store locally (a safety drop)
    await sql`update store_whatsapp set owner = ${other.id}, lease_until = now() + interval '1 minute'
              where tenant_id = ${tenantId}`;
    await other.tick();
    // handed back, and with this store needing a socket the same tick claims it afresh
    const row = await waRow();
    expect(Number(row.lease_epoch)).toBeGreaterThan(Number(before.lease_epoch));
    await other.stop();
    // give the store back to the main gateway for the rest of the run
    await sql`update store_whatsapp set owner = null, lease_until = null where tenant_id = ${tenantId}`;
    const n = world.sockets.length;
    await gw.tick();
    await until(() => world.sockets.length > n);
    world.last.user = { id: `55${ownerPhone}:7@s.whatsapp.net`, name: 'Doce Lar' };
    world.last.connection({ connection: 'open' });
    await until(async () => (await waRow()).owner === gw.id && (await waRow()).state === 'open');
  });

  test('unlinked on the phone: logged out, login wiped, staff told; re-pairing works', async () => {
    world.last.close(401);
    await until(async () => (await waRow())?.state === 'logged_out');
    const auth = await sql`select 1 from store_wa_auth where tenant_id = ${tenantId}`;
    expect(auth.length).toBe(0);
    const ev = await sql<{ data: { step: string } }[]>`
      select data from staff_events where tenant_id = ${tenantId} and kind = 'whatsapp.store'
      order by id`;
    expect(ev.map((e) => e.data.step)).toEqual(['connected', 'lost', 'back', 'logged_out']);
    // nothing queues while there's no number to send from
    const id = await order({ mode: 'pickup' });
    await move(id, 'confirmed');
    expect((await messages()).some((m) => m.status === 'pending')).toBe(false);
    // the next tick lets the idle store go, still saying why it stopped
    await gw.tick();
    await until(() => gw.health().sessions === 0);
    expect((await waRow()).state).toBe('logged_out');
  });

  test('a code nobody typed expires; disconnect unlinks and forgets the login', async () => {
    const r = await owner('POST', '/whatsapp/pair', { phone: ownerPhone });
    expect(r.status).toBe(200);
    await gw.tick();
    const before = world.sockets.length;
    await until(() => world.sockets.length === before + 1);
    world.last.connection({ qr: 'ref' });
    await until(async () => (await waRow())?.state === 'pairing');
    world.last.close(408); // WhatsApp ran out of pairing refs
    await until(async () => (await waRow())?.state === 'off');
    expect((await waRow()).detail).toBe('pair_expired');
    expect((await owner('GET', '/whatsapp')).body.detail).toBe('pair_expired');

    // pair for real this time, then disconnect
    await owner('POST', '/whatsapp/pair', { phone: ownerPhone });
    await gw.tick();
    await until(() => world.sockets.length === before + 2);
    const s = world.last;
    s.connection({ qr: 'ref' });
    await until(async () => (await waRow())?.state === 'pairing');
    s.creds.registered = true;
    s.emit('creds.update', {});
    s.connection({ isNewLogin: true });
    s.close(515);
    await until(() => world.sockets.length === before + 3);
    world.last.user = { id: `55${ownerPhone}@s.whatsapp.net` };
    world.last.connection({ connection: 'open' });
    await until(async () => (await waRow())?.state === 'open');

    const live = world.last;
    // a message the gateway is sending right now must not come back after the disconnect
    const inFlight = (
      await sql<{ id: string }[]>`
        insert into store_wa_messages (tenant_id, kind, phone, body, status, attempts, lease_until)
        values (${tenantId}, 'test', ${managerPhone}, 'in flight', 'sending', 1, now() + interval '1 minute')
        returning id`
    )[0]!.id;
    const d = await owner('POST', '/whatsapp/disconnect', {});
    expect(d.status).toBe(200);
    expect(d.body.state).toBe('off');
    await gw.tick();
    await until(() => live.loggedOut);
    await until(async () => (await waRow())?.wipe_requested_at === null);
    expect((await sql`select 1 from store_wa_auth where tenant_id = ${tenantId}`).length).toBe(0);
    await until(async () => gw.health().sessions === 0 && (await waRow()).owner === null);
    expect((await waRow()).state).toBe('off');
    const flight = await sql<{ status: string; error: string }[]>`
      select status, error from store_wa_messages where id = ${inFlight}`;
    expect(flight[0]).toEqual({ status: 'skipped', error: 'disconnected' });
  });

  test('pending messages past their moment expire; Core notices a silent gateway', async () => {
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, body, expires_at)
      values (${tenantId}, 'test', ${shopperPhone}, 'old', now() - interval '1 minute')`;
    await housekeeping(appSql);
    expect((await messages()).find((m) => m.body === 'old')!.status).toBe('expired');

    await gw.stop();
    // a store that wants its WhatsApp and no gateway beating: the team hears it once
    await sql`update store_whatsapp set wanted = true, state = 'open' where tenant_id = ${tenantId}`;
    const fresh = await sql`select 1 from wa_gateways where seen_at > now() - interval '2 minutes'`;
    if (fresh.length === 0) {
      expect(await checkGateway(appSql)).toBe('down');
      const v = await owner('GET', '/whatsapp');
      expect(v.body.state).toBe('connecting');
      expect(v.body.detail).toBe('gateway_offline');
    }
    await sql`update store_whatsapp set wanted = false, state = 'off' where tenant_id = ${tenantId}`;
    await sql`delete from staff_events where anchor = 'channel:whatsapp_lojas'`;
  });

  test('disconnect with no gateway alive forgets the login in Core', async () => {
    await sql`update store_whatsapp set wanted = true, state = 'logged_out' where tenant_id = ${tenantId}`;
    await sql`insert into store_wa_auth (tenant_id, category, name, data) values (${tenantId}, 'creds', 'main', '{}')`;
    const d = await owner('POST', '/whatsapp/disconnect', {});
    expect(d.status).toBe(200);
    expect((await waRow()).detail).toBe('unlinked_offline');
    expect((await sql`select 1 from store_wa_auth where tenant_id = ${tenantId}`).length).toBe(0);
  });
});
