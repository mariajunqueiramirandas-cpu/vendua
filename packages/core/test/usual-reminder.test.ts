import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  renderUsualReminder,
  usualOrderTx,
  usualReminderPass,
} from '../src/modules/usual-reminder.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { OPT_OUT_FOOTER, USUAL_INVITE } from '../src/store-whatsapp/messages.ts';
import { handleInbound } from '../src/store-whatsapp/state.ts';
import { optKeyword } from '../src/store-whatsapp/text.ts';

// "O de sempre" (the owner, 2026-10-13: opt-in and caps): a shopper who asked is reminded of their
// usual order from the store's own WhatsApp, at most weekly, under a daily ceiling per store.

describe('usual reminder: words', () => {
  test('the basket, a one-tap link and how to stop', () => {
    const t = renderUsualReminder({
      storeName: 'Doce Lar',
      firstName: 'Ana',
      lines: [
        { name: 'Marmita', qty: 2 },
        { name: 'Suco', qty: 1 },
      ],
      url: 'https://doce.x/?cart=Abc123456789',
    });
    expect(t).toContain('Oi, Ana! Aqui é da Doce Lar');
    expect(t).toContain('2x Marmita e Suco.');
    expect(t).toContain('https://doce.x/?cart=Abc123456789');
    expect(t.endsWith(OPT_OUT_FOOTER)).toBe(true);
  });

  test('LEMBRAR and its spellings are a keyword; a sentence is not', () => {
    for (const w of ['LEMBRAR', 'lembrar', 'Me lembre', 'lembrete'])
      expect(optKeyword(w)).toBe('remind');
    expect(optKeyword('lembrar de mim amanhã por favor')).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('usual reminder (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    otpSender: async () => {},
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;
  let num = 0;
  const yes = () => 0;

  const call = async (host: string, method: string, path: string, headers = {}) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-${++idem}`,
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  interface Store {
    id: string;
    host: string;
    products: string[];
  }
  const store = async (o: { on?: boolean; perDay?: number } = {}): Promise<Store> => {
    const slug = `ur-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Marmitas ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state, usual_reminder, usual_per_day)
              values (${t!.id}, true, 'open', ${o.on !== false}, ${o.perDay ?? 20})`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'pratos', 'Pratos') returning id`;
    const products: string[] = [];
    for (const name of ['Marmita', 'Suco', 'Pudim']) {
      const [p] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${t!.id}, ${cat!.id}, ${name.toLowerCase()}, ${name}, 1500) returning id`;
      products.push(p!.id);
    }
    return { id: t!.id, host, products };
  };

  /** a past order (no cart: a counter sale) of these products, this many days ago */
  const order = async (
    s: Store,
    phone: string,
    days: number,
    lines: [number, number][],
    o: { state?: string; cartId?: string } = {},
  ) => {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (tenant_id, number, source, cart_id, state, customer, customer_phone, delivery,
                          payment, subtotal_cents, total_cents, placed_at)
      values (${s.id}, ${++num}, ${o.cartId ? 'storefront' : 'pdv'}, ${o.cartId ?? null},
              ${o.state ?? 'delivered'}, ${sql.json({ name: 'Ana Souza', phone })}, ${phone},
              ${sql.json({ mode: 'pickup' })}, ${sql.json({ method: 'cash' })}, 3000, 3000,
              now() - ${days + ' days'}::interval)
      returning id`;
    for (const [k, [p, qty]] of lines.entries())
      await sql`
        insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                                 modifiers, combo, line_total_cents, sort)
        values (${s.id}, ${row!.id}, ${s.products[p]!}, ${'p' + p}, ${['Marmita', 'Suco', 'Pudim'][p]!},
                ${qty}, 1500, '[]', '[]', ${1500 * qty}, ${k})`;
    return row!.id;
  };
  const consent = (s: Store, phone: string, days = 0) => sql`
    insert into usual_reminders (tenant_id, phone, name, source, consented_at)
    values (${s.id}, ${phone}, 'Ana Souza', 'checkout', now() - ${days + ' days'}::interval)`;
  const queued = (s: Store) =>
    sql<Record<string, any>[]>`
      select * from store_wa_messages where tenant_id = ${s.id} and kind = 'usual_reminder'
      order by created_at`;
  const phone = (k: number) => `21${9}${stamp}${k}`.slice(0, 11);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('"the usual" is the basket seen most, not cancelled ones; else the latest', async () => {
    const s = await store();
    const p = phone(1);
    await order(s, p, 30, [
      [0, 2],
      [1, 1],
    ]);
    await order(s, p, 20, [
      [0, 2],
      [1, 1],
    ]);
    await order(s, p, 10, [[2, 1]]);
    await order(s, p, 5, [[2, 1]], { state: 'cancelled' });
    await order(s, p, 4, [[2, 1]], { state: 'cancelled' });
    const u = await withTenant(sql, s.id, (tx) => usualOrderTx(tx, s.id, p));
    expect(u!.lines).toEqual([
      { name: 'Marmita', qty: 2 },
      { name: 'Suco', qty: 1 },
    ]);
    const q = phone(2);
    await order(s, q, 9, [[0, 1]]);
    await order(s, q, 8, [[2, 3]]);
    const v = await withTenant(sql, s.id, (tx) => usualOrderTx(tx, s.id, q));
    expect(v!.lines).toEqual([{ name: 'Pudim', qty: 3 }]);
  });

  test('one a week per shopper, never right after an order, only to who asked', async () => {
    const s = await store();
    const asked = phone(3);
    const recent = phone(4);
    const silent = phone(5);
    await order(s, asked, 9, [
      [0, 2],
      [1, 1],
    ]);
    await order(s, recent, 3, [[0, 1]]);
    await order(s, silent, 20, [[0, 1]]);
    await consent(s, asked);
    await consent(s, recent);
    // the coin says no: nothing this pass
    expect(await usualReminderPass(sql, s.id, new Date(), () => 0.9)).toBe(0);
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(1);
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(0);
    const [m, ...rest] = await queued(s);
    expect(rest).toEqual([]);
    expect(m!.phone).toBe(asked);
    expect(m!.body).toContain('Oi, Ana! Aqui é da Marmitas');
    expect(m!.body).toContain('2x Marmita e Suco.');
    expect(m!.body.endsWith(OPT_OUT_FOOTER)).toBe(true);
    const code = /\/\?cart=([A-Za-z0-9]{12})/.exec(m!.body)![1]!;
    const [share] = await sql<{ items: unknown[] }[]>`
      select items from cart_shares where tenant_id = ${s.id} and code = ${code}`;
    expect(share!.items.length).toBe(2);
  });

  test('the daily ceiling, the switch, a closed store and SAIR all hold it back', async () => {
    const s = await store({ perDay: 1 });
    for (const k of [6, 7]) {
      await order(s, phone(k), 10, [[0, 1]]);
      await consent(s, phone(k));
    }
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(1);
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(0);
    await sql`update store_whatsapp set usual_per_day = 5 where tenant_id = ${s.id}`;
    await sql`update store_whatsapp set usual_reminder = false where tenant_id = ${s.id}`;
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(0);
    await sql`update store_whatsapp set usual_reminder = true where tenant_id = ${s.id}`;
    await sql`update store_settings set status_override = 'closed' where tenant_id = ${s.id}`;
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(0);
    await sql`update store_settings set status_override = null where tenant_id = ${s.id}`;
    const left = (await queued(s))[0]!.phone === phone(6) ? phone(7) : phone(6);
    await sql`insert into store_wa_optouts (tenant_id, phone) values (${s.id}, ${left})`;
    expect(await usualReminderPass(sql, s.id, new Date(), yes)).toBe(0);
    const [gone] = await sql`
      select 1 from usual_reminders where tenant_id = ${s.id} and phone = ${left}`;
    expect(gone).toBeUndefined();
  });

  test('a consent lapses after months without an order', async () => {
    const s = await store();
    const p = phone(8);
    await order(s, p, 200, [[0, 1]]);
    await consent(s, p, 150);
    expect(await usualReminderPass(sql, s.id, new Date(), () => 0.9)).toBe(0);
    const [r] = await sql`select 1 from usual_reminders where tenant_id = ${s.id} and phone = ${p}`;
    expect(r).toBeUndefined();
  });

  test('checkout: the number comes from the order this session placed', async () => {
    const s = await store();
    const sess = await call(s.host, 'POST', '/checkout/v1/session');
    expect(sess.status).toBe(201);
    const auth = { authorization: `Bearer ${sess.body.sessionToken}` };
    const path = '/checkout/v1/usual-reminder';
    expect((await call(s.host, 'POST', path)).status).toBe(401);
    const early = await call(s.host, 'POST', path, auth);
    expect([early.status, early.body.error.code]).toEqual([409, 'ORDER_REQUIRED']);
    const p = phone(9);
    await order(s, p, 0, [[0, 1]], { cartId: sess.body.cart.id });
    const ok = await call(s.host, 'POST', path, auth);
    expect([ok.status, ok.body]).toEqual([200, { reminder: { on: true } }]);
    const [row] = await sql<{ source: string; name: string }[]>`
      select source, name from usual_reminders where tenant_id = ${s.id} and phone = ${p}`;
    expect(row).toEqual({ source: 'checkout', name: 'Ana Souza' });
    const off = await call(s.host, 'DELETE', path, auth);
    expect(off.body).toEqual({ reminder: { on: false } });
    const [none] =
      await sql`select 1 from usual_reminders where tenant_id = ${s.id} and phone = ${p}`;
    expect(none).toBeUndefined();

    const shut = await store({ on: false });
    const s2 = await call(shut.host, 'POST', '/checkout/v1/session');
    await order(shut, p, 0, [[0, 1]], { cartId: s2.body.cart.id });
    const r = await call(shut.host, 'POST', path, {
      authorization: `Bearer ${s2.body.sessionToken}`,
    });
    expect([r.status, r.body.error.code]).toEqual([409, 'REMINDER_OFF']);
    expect((await call(shut.host, 'GET', '/storefront/v1/store')).body.usualReminder).toBe(false);
    expect((await call(s.host, 'GET', '/storefront/v1/store')).body.usualReminder).toBe(true);
  });

  test('a delivered order offers it once; LEMBRAR from that shopper opts in', async () => {
    const s = await store();
    const p = phone(0);
    // the store texted them about an order: the delivered message carries the invitation
    await sql`
      insert into store_wa_messages (tenant_id, kind, event, phone, body, status)
      values (${s.id}, 'order', 'delivered', ${p}, ${'Entregue!' + USUAL_INVITE}, 'sent')`;
    await handleInbound(sql, s.id, { phone: p, jid: null, text: 'Lembrar', id: 'm1' } as never);
    const [row] = await sql<{ source: string }[]>`
      select source from usual_reminders where tenant_id = ${s.id} and phone = ${p}`;
    expect(row!.source).toBe('whatsapp');
    const [ack] = await sql<{ body: string }[]>`
      select body from store_wa_messages where tenant_id = ${s.id} and kind = 'opt_in'`;
    expect(ack!.body).toContain('pedido de sempre');
    // a stranger's LEMBRAR is ignored
    await handleInbound(sql, s.id, {
      phone: '21911112222',
      jid: null,
      text: 'lembrar',
      id: 'm2',
    } as never);
    const [stranger] = await sql`
      select 1 from usual_reminders where tenant_id = ${s.id} and phone = '21911112222'`;
    expect(stranger).toBeUndefined();
  });
});
