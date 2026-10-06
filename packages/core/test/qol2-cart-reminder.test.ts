import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pino from 'pino';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { cartReminderPass, renderCartReminder } from '../src/modules/cart-reminder.ts';
import { migrate } from '../src/platform/db.ts';
import { seal } from '../src/platform/secrets.ts';
import { Gateway } from '../src/store-whatsapp/gateway.ts';
import { OPT_OUT_FOOTER } from '../src/store-whatsapp/messages.ts';
import type {
  ConnectionUpdate,
  Creds,
  OutContent,
  SocketKeys,
  WaRuntime,
  WaSocket,
} from '../src/store-whatsapp/session.ts';
import { handleInbound } from '../src/store-whatsapp/state.ts';

// The bag reminder (owner, 2026-10-06): a store without the Vendedor may send one WhatsApp
// message from its own number to a shopper who ticked "me lembre" at checkout and left the bag.

describe('bag reminder: words', () => {
  const base = { storeName: 'Doce Lar', firstName: 'Ana', url: 'https://doce.x/?cart=Abc12345' };
  test('up to three items, then "e mais N", and how to stop', () => {
    const one = renderCartReminder({ ...base, lines: [{ name: 'Pudim', qty: 2 }] });
    expect(one).toContain('Oi, Ana! Aqui é da Doce Lar');
    expect(one).toContain('Sua sacola ficou guardada: 2x Pudim.');
    expect(one).toContain('https://doce.x/?cart=Abc12345');
    expect(one.endsWith(OPT_OUT_FOOTER)).toBe(true);
    const three = renderCartReminder({
      ...base,
      lines: [
        { name: 'Pudim', qty: 1 },
        { name: 'Bolo', qty: 1 },
        { name: 'Café', qty: 3 },
      ],
    });
    expect(three).toContain('Pudim, Bolo e 3x Café.');
    const five = renderCartReminder({
      ...base,
      firstName: '',
      lines: ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, qty: 1 })),
    });
    expect(five).toContain('Oi! Aqui é da');
    expect(five).toContain('A, B, C e mais 2 itens.');
    const long = renderCartReminder({ ...base, lines: [{ name: 'x'.repeat(300), qty: 1 }] });
    expect(long.length).toBeLessThan(400);
  });
});

type Handler = (payload: never) => void;

class FakeSocket implements WaSocket {
  private handlers = new Map<string, Handler[]>();
  sent: { jid: string; text: string }[] = [];
  user: WaSocket['user'] = undefined;
  ev = {
    on: (event: string, cb: Handler) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    },
  } as WaSocket['ev'];
  constructor(readonly creds: Creds) {}
  connection(u: ConnectionUpdate) {
    for (const h of this.handlers.get('connection.update') ?? []) h(u as never);
  }
  async requestPairingCode() {
    return 'ABCD1234';
  }
  async onWhatsApp(...jids: string[]) {
    return jids.map((jid) => ({ jid, exists: true }));
  }
  async sendMessage(jid: string, content: OutContent | object) {
    this.sent.push({ jid, text: (content as { text: string }).text });
    return { key: { id: 'x' } };
  }
  async updateMediaMessage<M>(m: M) {
    return m;
  }
  async presenceSubscribe() {}
  async sendPresenceUpdate() {}
  async logout() {}
  end() {}
}

async function until(cond: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('bag reminder (db)', () => {
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
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;
  const sockets: FakeSocket[] = [];
  let gw: Gateway | null = null;

  const call = async (
    host: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      headers: res.headers,
      cookie: res.headers.get('set-cookie'),
    };
  };

  interface Store {
    id: string;
    host: string;
    products: string[];
  }
  const store = async (
    o: { reminder?: boolean; linked?: boolean; vendedor?: boolean } = {},
  ): Promise<Store> => {
    const slug = `cr-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Doce ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})`;
    if (o.linked !== false)
      await sql`insert into store_whatsapp (tenant_id, wanted, state, cart_reminder)
                values (${t!.id}, true, 'open', ${o.reminder !== false})`;
    if (o.vendedor) await sql`insert into store_agent (tenant_id, enabled) values (${t!.id}, true)`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'doces', 'Doces') returning id`;
    const products: string[] = [];
    for (const name of ['Pudim', 'Bolo de pote', 'Brigadeiro', 'Café', 'Torta']) {
      const [p] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${t!.id}, ${cat!.id}, ${name.toLowerCase().replace(/\s/g, '-')}, ${name}, 1200)
        returning id`;
      products.push(p!.id);
    }
    return { id: t!.id, host, products };
  };

  /** a shopper's bag on this store: its session and cart */
  const bag = async (s: Store, lines = 1) => {
    const r = await call(s.host, 'POST', '/checkout/v1/session');
    expect(r.status).toBe(201);
    const auth = { authorization: `Bearer ${r.body.sessionToken}` };
    for (let i = 0; i < lines; i++) {
      const a = await call(
        s.host,
        'POST',
        '/checkout/v1/cart/items',
        { productId: s.products[i], qty: i === 0 ? 2 : 1 },
        auth,
      );
      expect(a.status).toBe(200);
    }
    return { auth, cartId: r.body.cart.id as string };
  };
  const consent = (s: Store, b: { auth: Record<string, string> }, body: unknown) =>
    call(s.host, 'POST', '/checkout/v1/cart/reminder', body, b.auth);
  /** the bag and the consent are this many minutes old */
  const idle = async (cartId: string, minutes: number) => {
    const at = new Date(Date.now() - minutes * 60_000);
    await sql`update carts set updated_at = ${at} where id = ${cartId}`;
    await sql`update cart_reminders set consented_at = ${at} where cart_id = ${cartId}`;
  };
  const reminder = async (cartId: string) =>
    (await sql<Record<string, any>[]>`select * from cart_reminders where cart_id = ${cartId}`)[0]!;
  const queued = (tenantId: string) =>
    sql<Record<string, any>[]>`
      select * from store_wa_messages where tenant_id = ${tenantId} and kind = 'cart_reminder'
      order by created_at`;
  const phone = (k: number) => `21${9}${stamp}${k}`.slice(0, 11);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    await gw?.stop();
    await sql`delete from wa_gateways where id like ${'gw-' + nonce + '%'}`;
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('consent: the cart session, a claimed key, bounded input, only where offered', async () => {
    const s = await store();
    const b = await bag(s);
    const path = '/checkout/v1/cart/reminder';
    expect((await call(s.host, 'POST', path, { phone: phone(1) })).status).toBe(401);
    const noKey = await app.request(`http://${s.host}${path}`, {
      method: 'POST',
      headers: { host: s.host, 'content-type': 'application/json', ...b.auth },
      body: JSON.stringify({ phone: phone(1) }),
    });
    expect(noKey.status).toBe(400);
    const bad = await consent(s, b, { phone: '123' });
    expect([bad.status, bad.body.error.code]).toEqual([422, 'INVALID_PHONE']);
    expect((await consent(s, b, { phone: phone(1), name: 'x'.repeat(201) })).status).toBe(422);
    expect((await consent(s, b, { phone: phone(1), name: 7 })).status).toBe(422);

    const key = { ...b.auth, 'idempotency-key': `${nonce}-fixed` };
    const p = phone(1);
    const typed = `+55 (${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`;
    const ok = await call(
      s.host,
      'POST',
      path,
      { phone: typed, name: ` Bia ${'a'.repeat(120)}` },
      key,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ reminder: { on: true } });
    const again = await call(
      s.host,
      'POST',
      path,
      { phone: typed, name: ` Bia ${'a'.repeat(120)}` },
      key,
    );
    expect(again.headers.get('x-idempotent-replay')).toBe('true');
    const row = await reminder(b.cartId);
    expect(row.phone).toBe(p);
    expect(row.name.length).toBe(80);
    expect(row.name.startsWith('Bia')).toBe(true);

    const off = await call(s.host, 'DELETE', path, undefined, b.auth);
    expect([off.status, off.body]).toEqual([200, { reminder: { on: false } }]);
    const gone = await reminder(b.cartId);
    expect(gone.withdrawn_at).not.toBeNull();
    expect([gone.phone, gone.name]).toEqual([null, null]);

    // a store that doesn't offer it: off, not linked, or with the Vendedor on
    for (const o of [{ reminder: false }, { linked: false }, { vendedor: true }]) {
      const other = await store(o);
      const ob = await bag(other);
      const r = await consent(other, ob, { phone: phone(1) });
      expect([r.status, r.body.error.code]).toEqual([409, 'REMINDER_OFF']);
    }
  });

  test('the public store says whether checkout may offer it, and follows the switch', async () => {
    const s = await store();
    const read = async () => (await call(s.host, 'GET', '/storefront/v1/store')).body.cartReminder;
    expect(await read()).toBe(true);
    await sql`update store_whatsapp set cart_reminder = false where tenant_id = ${s.id}`;
    expect(await read()).toBe(false);
    await sql`update store_whatsapp set cart_reminder = true where tenant_id = ${s.id}`;
    expect(await read()).toBe(true);
    // the number unlinked, or the Vendedor turned on: not offered
    await sql`update store_whatsapp set state = 'logged_out' where tenant_id = ${s.id}`;
    expect(await read()).toBe(false);
    await sql`update store_whatsapp set state = 'open' where tenant_id = ${s.id}`;
    await sql`insert into store_agent (tenant_id, enabled) values (${s.id}, true)`;
    expect(await read()).toBe(false);
    const plain = await store({ reminder: false });
    expect((await call(plain.host, 'GET', '/storefront/v1/store')).body.cartReminder).toBe(false);
  });

  test('one message per bag, an hour after it stopped, in the store’s words', async () => {
    const s = await store();
    const b = await bag(s, 4);
    expect((await consent(s, b, { phone: phone(2), name: 'Bia Souza' })).status).toBe(200);
    await idle(b.cartId, 30);
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    await idle(b.cartId, 61);
    // two replicas sweeping at once still queue one
    const [x, y] = await Promise.all([cartReminderPass(sql, s.id), cartReminderPass(sql, s.id)]);
    expect(x + y).toBe(1);
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    const [m] = await queued(s.id);
    expect(m!.phone).toBe(phone(2));
    expect(m!.cart_id).toBe(b.cartId);
    expect(m!.body).toContain('Oi, Bia! Aqui é da Doce');
    expect(m!.body).toContain('2x Pudim, Bolo de pote, Brigadeiro e mais 1 item.');
    expect(m!.body.endsWith(OPT_OUT_FOOTER)).toBe(true);
    const code = /\/\?cart=([A-Za-z0-9]+)/.exec(m!.body)![1]!;
    const [share] = await sql`select source_cart_id from cart_shares where code = ${code}`;
    expect(share!.source_cart_id).toBe(b.cartId);
    // the link opens the bag on another device
    const other = await call(s.host, 'POST', '/checkout/v1/session');
    const imported = await call(
      s.host,
      'POST',
      '/checkout/v1/cart/import',
      { shareCode: code },
      { authorization: `Bearer ${other.body.sessionToken}` },
    );
    expect(imported.status).toBe(200);
    expect(imported.body.report.added).toBe(4);
    // tapped on the phone that still holds the bag: nothing doubles
    const same = await call(
      s.host,
      'POST',
      '/checkout/v1/cart/import',
      { shareCode: code },
      b.auth,
    );
    expect(same.status).toBe(200);
    expect(same.body.report.added).toBe(0);
    expect(
      same.body.cart.items.map((i: { quantity?: number; qty?: number }) => i.quantity ?? i.qty),
    ).toEqual(
      imported.body.cart.items.map((i: { quantity?: number; qty?: number }) => i.quantity ?? i.qty),
    );
    // marked in the same transaction, and the number no longer kept
    const row = await reminder(b.cartId);
    expect(row.sent_at).not.toBeNull();
    expect(row.phone).toBeNull();
    // ticking it again on the same bag never earns a second message
    expect((await consent(s, b, { phone: phone(2) })).status).toBe(200);
    await idle(b.cartId, 90);
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect(await queued(s.id)).toHaveLength(1);
  });

  test('skipped: ordered, withdrawn, opted out, a Vendedor thread, the switch off, after 24 h', async () => {
    const s = await store();
    const mk = async (k: number) => {
      const b = await bag(s);
      expect((await consent(s, b, { phone: phone(k) })).status).toBe(200);
      return b;
    };
    const ordered = await mk(3);
    await sql`update carts set status = 'completed' where id = ${ordered.cartId}`;
    const withdrawn = await mk(4);
    await call(s.host, 'DELETE', '/checkout/v1/cart/reminder', undefined, withdrawn.auth);
    const optedOut = await mk(5);
    await sql`insert into store_wa_optouts (tenant_id, phone) values (${s.id}, ${phone(5)})`;
    const threaded = await mk(6);
    await sql`insert into shopper_threads (tenant_id, channel, address, cart_id, class)
              values (${s.id}, 'web', ${`web:${threaded.cartId}`}, ${threaded.cartId}, 'shopper')`;
    const stale = await mk(7);
    for (const b of [ordered, withdrawn, optedOut, threaded]) await idle(b.cartId, 61);
    await idle(stale.cartId, 25 * 60);

    // the switch off: nothing goes, nothing is consumed
    await sql`update store_whatsapp set cart_reminder = false where tenant_id = ${s.id}`;
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect((await reminder(optedOut.cartId)).skipped).toBeNull();
    await sql`update store_whatsapp set cart_reminder = true where tenant_id = ${s.id}`;

    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect(await queued(s.id)).toHaveLength(0);
    expect((await reminder(ordered.cartId)).skipped).toBe('ordered');
    expect((await reminder(withdrawn.cartId)).skipped).toBeNull();
    expect((await reminder(optedOut.cartId)).skipped).toBe('opted_out');
    expect((await reminder(threaded.cartId)).skipped).toBe('vendedor_thread');
    expect((await reminder(stale.cartId)).skipped).toBe('expired');
    expect((await reminder(stale.cartId)).phone).toBeNull();

    // a store whose Vendedor is on recovers its own bags: an old consent never goes
    const v = await store();
    const vb = await bag(v);
    expect((await consent(v, vb, { phone: phone(8) })).status).toBe(200);
    await sql`insert into store_agent (tenant_id, enabled) values (${v.id}, true)`;
    await idle(vb.cartId, 61);
    expect(await cartReminderPass(sql, v.id)).toBe(0);
    expect(await queued(v.id)).toHaveLength(0);
  });

  test('never at night: a closed store waits for the opening, still inside the 24 h', async () => {
    const s = await store();
    const b = await bag(s);
    expect((await consent(s, b, { phone: phone(9) })).status).toBe(200);
    await idle(b.cartId, 8 * 60);
    await sql`update store_settings set status_override = 'closed' where tenant_id = ${s.id}`;
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect((await reminder(b.cartId)).skipped).toBeNull();
    await sql`update store_settings set status_override = null where tenant_id = ${s.id}`;
    expect(await cartReminderPass(sql, s.id)).toBe(1);
  });

  test('an hourly ceiling of its own, and one reminder per number a week', async () => {
    const s = await store();
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, body, status, sent_at)
      select ${s.id}, 'cart_reminder', ${phone(0)}, 'x', 'sent', now() from generate_series(1, 20)`;
    const b = await bag(s);
    expect((await consent(s, b, { phone: phone(1) })).status).toBe(200);
    await idle(b.cartId, 61);
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect((await reminder(b.cartId)).sent_at).toBeNull();
    await sql`update store_wa_messages set created_at = now() - interval '2 hours'
              where tenant_id = ${s.id}`;
    expect(await cartReminderPass(sql, s.id)).toBe(1);
    // the same number's next bag that week: no second reminder
    const b2 = await bag(s);
    expect((await consent(s, b2, { phone: phone(1) })).status).toBe(200);
    await idle(b2.cartId, 61);
    expect(await cartReminderPass(sql, s.id)).toBe(0);
    expect((await reminder(b2.cartId)).skipped).toBe('recent');
  });

  test('SAIR from someone who got a reminder stops the store texting them', async () => {
    const s = await store();
    const p = phone(4);
    await sql`insert into store_wa_messages (tenant_id, kind, phone, body, status, sent_at)
              values (${s.id}, 'cart_reminder', ${p}, 'x', 'sent', now())`;
    await sql`insert into store_wa_messages (tenant_id, kind, phone, body)
              values (${s.id}, 'store_open', ${p}, 'abrimos')`;
    await handleInbound(appSql, s.id, { phone: p, text: 'SAIR', id: 'in-1' });
    const outs = await sql`select phone from store_wa_optouts where tenant_id = ${s.id}`;
    expect(outs.map((o) => o.phone)).toEqual([p]);
    const rows = await sql`select kind, status, error from store_wa_messages
                           where tenant_id = ${s.id} order by created_at`;
    expect(rows.find((r) => r.kind === 'store_open')).toMatchObject({
      status: 'skipped',
      error: 'opted_out',
    });
    expect(rows.some((r) => r.kind === 'opt_out')).toBe(true);
  });

  test('the gateway: order notices first, reminders always say how to stop, a bag ordered meanwhile is dropped', async () => {
    const s = await store();
    await sql`
      insert into store_wa_auth (tenant_id, category, name, data)
      values (${s.id}, 'creds', 'main', ${JSON.stringify(seal(JSON.stringify({ registered: true }), 's'))})`;
    const live = await bag(s);
    const done = await bag(s);
    await sql`update carts set status = 'completed' where id = ${done.cartId}`;
    // the reminder was queued first; the order notice came later
    await sql`insert into store_wa_messages (tenant_id, kind, cart_id, phone, body, created_at)
              values (${s.id}, 'cart_reminder', ${live.cartId}, ${phone(5)}, 'lembrete', now() - interval '1 minute'),
                     (${s.id}, 'cart_reminder', ${done.cartId}, ${phone(6)}, 'lembrete 2', now() - interval '1 minute')`;
    await sql`insert into store_wa_messages (tenant_id, kind, event, phone, body)
              values (${s.id}, 'order', 'placed', ${phone(7)}, 'pedido')`;
    const runtime: WaRuntime = {
      codec: { replacer: (_k, v) => v, reviver: (_k, v) => v },
      initCreds: () => ({}),
      normalize: (m) => m,
      download: async () => new Uint8Array(),
      connect: async ({ creds }) => {
        const sock = new FakeSocket(creds);
        sockets.push(sock);
        return sock;
      },
    };
    gw = new Gateway({
      sql: appSql,
      runtime,
      sealSecret: 's',
      id: `gw-${nonce}-1`,
      listen: false,
      tickMs: 3_600_000,
      leaseMs: 600_000,
      minSendGapMs: 1,
      conversationGapMs: 1,
      reconnectDelay: () => 5,
      tenants: [s.id],
      log: pino({ level: 'silent' }),
    });
    await gw.tick();
    await until(() => sockets.length > 0);
    sockets[0]!.user = { id: '5521999990000:7@s.whatsapp.net', name: 'Loja' };
    sockets[0]!.connection({ connection: 'open' });
    await until(
      async () =>
        (await sql`select 1 from store_whatsapp where tenant_id = ${s.id} and state = 'open'`)
          .length > 0,
    );
    gw.pump(s.id);
    await until(() => sockets[0]!.sent.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    const sent = sockets[0]!.sent;
    expect(sent.map((m) => m.jid)).toEqual(
      [phone(7), phone(5)].map((p) => `55${p}@s.whatsapp.net`),
    );
    expect(sent.map((m) => m.text)).toEqual([
      `pedido${OPT_OUT_FOOTER}`,
      `lembrete${OPT_OUT_FOOTER}`,
    ]);
    const dropped =
      await sql`select status, error from store_wa_messages where cart_id = ${done.cartId}`;
    expect(dropped[0]).toMatchObject({ status: 'skipped', error: 'ordered' });
  });

  test('LGPD: the export lists a pending consent, forget withdraws it and drops the number', async () => {
    const s = await store();
    const owner = `2197${stamp}`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${s.id}, 'Rita', ${owner}, 'owner')`;
    await call(
      s.host,
      'POST',
      '/admin/v1/auth/otp/start',
      { phone: owner },
      { 'x-vendua-admin': '1' },
    );
    const v = await call(
      s.host,
      'POST',
      '/admin/v1/auth/otp/verify',
      { phone: owner, code: codes.get(owner) },
      { 'x-vendua-admin': '1' },
    );
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.cookie ?? '')![1]!}`;
    const admin = (method: string, path: string, body?: unknown) =>
      call(s.host, method, `/admin/v1${path}`, body, { cookie, 'x-vendua-admin': '1' });

    const p = phone(8);
    const b = await bag(s);
    expect((await consent(s, b, { phone: p, name: 'Bia' })).status).toBe(200);
    const [cart] = await sql<{ id: string }[]>`
      insert into carts (tenant_id, session_hash, status) values (${s.id}, ${`cr-${nonce}-o`}, 'completed')
      returning id`;
    await sql`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents)
      values (${s.id}, ${cart!.id}, 1, ${sql.json({ name: 'Bia', phone: p })}, ${p},
              ${sql.json({ mode: 'pickup' })}, ${sql.json({ provider: 'sandbox', method: 'pix', status: 'pending' })},
              'placed', 1200, 1200)`;
    const exp = await admin('GET', `/customers/${p}/export`);
    expect(exp.status).toBe(200);
    expect(exp.body.cartReminders).toHaveLength(1);
    expect(exp.body.cartReminders[0].name).toBe('Bia');
    const f = await admin('POST', `/customers/${p}/forget`, { confirm: p.slice(-4) });
    expect(f.status).toBe(200);
    const row = await reminder(b.cartId);
    expect([row.phone, row.name]).toEqual([null, null]);
    expect(row.withdrawn_at).not.toBeNull();
  });

  test('admin: the switch, a preview in the store’s words, and never alongside the Vendedor', async () => {
    const s = await store({ reminder: false });
    const owner = `2198${stamp}`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${s.id}, 'Rita', ${owner}, 'owner')`;
    await call(
      s.host,
      'POST',
      '/admin/v1/auth/otp/start',
      { phone: owner },
      { 'x-vendua-admin': '1' },
    );
    const v = await call(
      s.host,
      'POST',
      '/admin/v1/auth/otp/verify',
      { phone: owner, code: codes.get(owner) },
      { 'x-vendua-admin': '1' },
    );
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.cookie ?? '')![1]!}`;
    const admin = (method: string, path: string, body?: unknown) =>
      call(s.host, method, `/admin/v1${path}`, body, { cookie, 'x-vendua-admin': '1' });

    const view = await admin('GET', '/whatsapp');
    expect(view.body.cartReminder.on).toBe(false);
    expect(view.body.cartReminder.vendedor).toBe(false);
    expect(view.body.cartReminder.preview).toContain(
      '2x Pudim, Bolo de pote, Brigadeiro e mais 1 item',
    );
    expect(view.body.cartReminder.preview.endsWith(OPT_OUT_FOOTER)).toBe(true);
    expect((await admin('PATCH', '/whatsapp/settings', { cartReminder: 'yes' })).status).toBe(422);
    const on = await admin('PATCH', '/whatsapp/settings', { cartReminder: true });
    expect(on.status).toBe(200);
    expect(on.body.cartReminder.on).toBe(true);
    // the order steps are untouched by it
    expect(on.body.events.placed).toBe(true);
    const audit =
      await sql`select action from audit_log where tenant_id = ${s.id} and action = 'whatsapp.cart_reminder'`;
    expect(audit).toHaveLength(1);
    await admin('PATCH', '/whatsapp/settings', { cartReminder: false });
    await sql`insert into store_agent (tenant_id, enabled) values (${s.id}, true)`;
    const blocked = await admin('PATCH', '/whatsapp/settings', { cartReminder: true });
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'VENDEDOR_ON']);
    expect((await admin('GET', '/whatsapp')).body.cartReminder.vendedor).toBe(true);
  });
});
